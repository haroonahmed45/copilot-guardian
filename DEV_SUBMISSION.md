# Beyond the Red X: AI That Debugs With You, Not For You

*This is a submission for the [GitHub Copilot CLI Challenge](https://dev.to/challenges/github-2026-01-21)*

---

## What I Built

**copilot-guardian** — An AI-powered GitHub Actions debugger that doesn't just fix your CI. It shows you *how it thinks*, gives you *choices*, and respects your *sovereignty*.

### The Problem Everyone Ignores

When your CI fails, you don't just need a fix. You need to understand **why** it failed.

Most tools hand you an answer. copilot-guardian shows you the **reasoning process**.

Logs are cryptic. Secrets are redacted. And the "quick fix" is often the dangerous one: `--force`, `continue-on-error`, or unnecessary complexity that creates tomorrow's bugs.

So I built a tool that transforms a failed GitHub Actions run into three auditable artifacts:

1. **Root-cause analysis** with 3 competing hypotheses (not just one guess)
2. **3 patch strategies** with different risk profiles (you choose)
3. **Quality verdicts** that flag over-engineered solutions (slop detection)

The philosophy is **Sovereign AI**: Copilot reasons transparently, but you maintain control. No auto-commits. No secret guessing. No surprises.

---

## Demo

### Try It Yourself (5 Minutes)

```bash
# Clone and install
gh repo clone flamehaven/copilot-guardian
cd copilot-guardian
npm install && npm run build

# Run against demo repo with intentional failure
npx copilot-guardian run \
  --repo flamehaven/copilot-guardian-demo \
  --last-failed \
  --show-reasoning \
  --show-options
```

### What You'll See

**Multi-Hypothesis Reasoning:**

![Multi-Hypothesis Dashboard](./assets/hypothesis-dashboard.png)

Copilot doesn't jump to conclusions. It explores three theories:
- H1: Environment variable missing [89%]
- H2: Node version mismatch [8%]
- H3: Network timeout [3%]

Each hypothesis comes with evidence, disconfirming signals, and a confidence score. You see *why* Copilot chose H1.

**Patch Spectrum:**

![Patch Spectrum](./assets/patch-spectrum.png)

Three strategies, three risk levels:
- **Conservative**: Minimal fix (+2 lines) → GO
- **Balanced**: Standard practice (+5 lines) → GO
- **Aggressive**: Over-engineered (+47 lines) → NO-GO, slop detected

The aggressive patch gets auto-flagged for adding unnecessary complexity. AI checking AI.

**Quality Verdict:**

```json
{
  "verdict": "GO",
  "reasons": [
    "Minimal change, focused on root cause",
    "No security weakening detected",
    "Follows workflow best practices"
  ],
  "risk_level": "low",
  "slop_score": 0.12
}
```

### Live Repository

**Demo**: [copilot-guardian-demo](https://github.com/flamehaven/copilot-guardian-demo) — Intentionally failing workflow ready to test  
**Main**: [copilot-guardian](https://github.com/flamehaven/copilot-guardian) — Full source code

---

## How I Used GitHub Copilot CLI

Most people use Copilot to **write code faster**. I used it to **think deeper**.

### Five Ways Copilot Powers This Tool

#### 1. Multi-Hypothesis Reasoning Engine

Instead of asking "what's wrong?", I ask "what are three *possible* explanations?"

```typescript
// prompts/analysis.v2.txt (excerpt)
"You must explore multiple hypotheses before selecting the most likely root cause.
Produce exactly 3 hypotheses in descending confidence order with evidence..."
```

This transforms Copilot from an answer machine into a **reasoning engine**. By forcing multiple hypotheses, it can't jump to conclusions — it has to show its work.

**Key insight**: Multi-hypothesis prompting eliminates confirmation bias in AI.

#### 2. Risk-Aware Patch Generation

I prompt Copilot to generate **three patch strategies**:

```typescript
// Three strategies with different risk profiles
"conservative: minimal fix, smallest diff
 balanced: standard fix, slightly more robust  
 aggressive: more changes / over-engineered (often NO-GO)"
```

This gives developers **agency**. A production hotfix needs Conservative. A major refactor might use Balanced.

**Key insight**: Different situations need different risk tolerances. Let the developer choose.

#### 3. Anti-Slop Quality Checks

After generating patches, I use Copilot **again** to critique its own output:

```typescript
// prompts/quality.v1.txt (excerpt)
"ANTI-SLOP CHECKS:
- Detect placeholder code (TODO, FIXME)
- Detect over-abstraction (unnecessary complexity)
- Detect explanation-implementation gap
- Detect complexity explosion (>3x LOC for minimal functionality)"
```

When the aggressive patch adds 47 lines for a 2-line fix, Copilot flags it:

```json
{
  "verdict": "NO_GO",
  "slop_score": 0.73,
  "reasons": ["Complexity explosion: 47 lines for env var addition"]
}
```

**Key insight**: AI can audit AI. This is meta-cognitive reasoning in practice.

#### 4. Interactive Debugging Sessions

The `debug --interactive` mode creates a **dialogue** with Copilot:

```bash
$ copilot-guardian debug --interactive --last-failed

You: Could this be a permissions issue?

Copilot: "Unlikely. The error explicitly states 'Environment variable 
[API_URL] is required but was not found', which is a configuration 
error, not permissions. Permissions errors manifest as 'Access denied'..."
```

Copilot remembers the context from the initial analysis. Follow-up questions get context-aware answers.

**Key insight**: Debugging is iterative. One-shot queries aren't enough.

#### 5. Complete Transparency

Every Copilot CLI interaction is saved:

```
.copilot-guardian/
├── copilot.analysis.raw.txt       # Original hypothesis generation
├── copilot.patch.options.raw.txt  # Patch strategy responses
├── copilot.quality.*.raw.txt      # Quality reviews for each patch
└── reasoning_trace.json           # Complete reasoning audit trail
```

You can audit **every word** Copilot said. No black boxes.

**Key insight**: Trust requires receipts, not magic.

---

## What Surprised Me About Copilot CLI

### 1. Copilot Excels at Structured Reasoning

I expected generic responses. Instead, Copilot produced nuanced hypothesis analyses:

For a Node version issue, it noted *"No version-related errors in logs"* as **disconfirming evidence** and ranked it at 8% confidence. That's genuine probabilistic reasoning.

### 2. Copilot Recognizes Its Own Over-Engineering

The aggressive patch consistently gets flagged for slop. Copilot **knows** when it's adding unnecessary complexity.

This suggests AI can be trained to recognize failure modes — if we give it the right evaluation frameworks.

### 3. Context Persistence Matters More Than I Thought

In interactive mode, Copilot references its previous analysis seamlessly. It feels less like "querying an API" and more like **pair programming with a colleague**.

---

## Technical Deep Dive

### Architecture: Why Terminal-First?

I could have built a web UI. But Copilot CLI is **terminal-native**, so copilot-guardian is too.

**Benefits:**
- Fits existing DevOps workflows
- No authentication complexity (uses `gh` CLI)
- Easy to script and automate
- All artifacts stay local (sovereignty)

### Security: Redaction First

Before sending anything to Copilot, secrets are scrubbed:

```typescript
export function redactSecrets(text: string): string {
  const patterns = [
    /ghp_[a-zA-Z0-9]{36}/g,           // GitHub tokens
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, // Bearer tokens
    /sk-[a-zA-Z0-9]{48}/g,             // API keys
    // ... 7 total patterns
  ];
  return patterns.reduce((t, p) => t.replace(p, "***REDACTED***"), text);
}
```

The input context is saved as `input.context.json` so you can verify Copilot never saw your secrets.

### Quality: Contract-Based AI

All Copilot responses must validate against JSON schemas:

```typescript
validateJson(analysis, "schemas/analysis.schema.json");
```

If Copilot returns malformed data, the tool fails loudly instead of degrading silently.

This is **design by contract** applied to AI outputs.

---

## Challenges I Overcame

### Challenge 1: Getting Structured JSON from Copilot

Early attempts returned markdown-wrapped JSON: ` ```json ... ``` `

**Solution**: Explicit prompt constraints + extraction utility:

```typescript
"OUTPUT FORMAT (STRICT JSON ONLY): {..."
```

Plus a parser that handles Copilot's occasional markdown wrapping.

### Challenge 2: Balancing Automation vs. Sovereignty

Early versions auto-applied patches. But that violated the core principle: **developers should decide**.

**Solution**: Always output `.patch` files. Developer runs `git apply` manually. This respects human agency.

### Challenge 3: Making Multi-Hypothesis Useful (Not Verbose)

Initial implementation dumped 20+ lines per hypothesis. Too noisy.

**Solution**: Terminal UI with visual hierarchy:

```
H1: Missing env var [89%]  ████████░░
  Evidence: Error mentions "API_URL not defined"
```

Confidence bars + truncated text = scannable output.

---

## Why This Matters Beyond the Challenge

This isn't just a CI debugger. It's a prototype for **how AI should assist humans**.

### Principle 1: Show Your Reasoning

Black-box AI erodes trust. Transparent AI builds it.

By showing three hypotheses with evidence, copilot-guardian makes Copilot's reasoning **auditable**. You understand *why* it chose H1, not just that it did.

### Principle 2: Offer Choices, Not Commands

"AI knows best" is patronizing. "Here are three options with trade-offs" respects developer expertise.

The Conservative/Balanced/Aggressive spectrum isn't just for patches — it's a framework for **risk-aware AI assistance** in any domain.

### Principle 3: Respect Human Sovereignty

- No auto-commit
- No secret guessing  
- No shell execution

All outputs are JSON and unified diffs. Humans review. Humans decide. Humans apply.

This is **Sovereign AI**: AI that amplifies human judgment instead of replacing it.

---

## Broader Applications

The patterns in copilot-guardian extend beyond CI/CD:

- **Code review**: Generate nitpick/balanced/high-level review strategies
- **Debugging**: Explore multiple root causes before committing to one
- **Architecture**: Propose conservative/balanced/aggressive designs
- **Security**: Use AI to critique AI-generated security patches

The meta-principle: **Use AI to think with you, not for you.**

---

## What's Next

Potential extensions:

- **Learning from preferences**: Track which strategies developers choose
- **Team patterns**: Aggregate failure modes across repositories
- **Simulation mode**: Predict patch success before applying
- **GitHub Action**: Auto-comment on failed runs with analysis

But the core is complete: A tool that shows reasoning, offers choices, and respects sovereignty.

---

## Try It

```bash
# Quick start (5 minutes)
gh repo clone flamehaven/copilot-guardian
cd copilot-guardian
npm install && npm run build

# Against demo repo
npx copilot-guardian run \
  --repo flamehaven/copilot-guardian-demo \
  --last-failed \
  --show-reasoning \
  --show-options

# Against your own repo
npx copilot-guardian run \
  --repo yourorg/yourrepo \
  --last-failed \
  --show-reasoning \
  --show-options
```

**Repository**: [github.com/flamehaven/copilot-guardian](https://github.com/flamehaven/copilot-guardian)  
**Demo**: [github.com/flamehaven/copilot-guardian-demo](https://github.com/flamehaven/copilot-guardian-demo)

---

## Closing Thoughts

Most CI tools tell you **what broke**.

copilot-guardian shows you:
- **Why** Copilot thinks it broke (3 hypotheses with evidence)
- **How** to fix it (3 strategies with risk profiles)
- **Whether** the fix is safe (anti-slop quality checks)

Every step is transparent. Every decision is auditable. You maintain control.

Because trust isn't built on magic.

**It's built on receipts.**

---

*Built by Flamehaven (Yun) — Part of the Sovereign AI research ecosystem*

*GitHub: [@flamehaven](https://github.com/flamehaven) | DEV: [@flamehaven](https://dev.to/flamehaven)*
