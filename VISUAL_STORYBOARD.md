# Visual Storyboard Guide - DEV.to Submission

## 📸 4 Hero Screenshots for Maximum Impact

### Screenshot 1: Multi-Hypothesis Dashboard ⭐⭐⭐⭐⭐

**What to Capture:**
```
Terminal showing:

=== MULTI-HYPOTHESIS REASONING ===

H1: Environment variable missing [89%] ████████░░
  Evidence: Error log mentions "API_URL not defined"
  Disconfirming: None found
  Next check: Review workflow env section

H2: Node version mismatch [8%] █░░░░░░░░░
  Evidence: No version-related errors detected
  Disconfirming: Setup Node step succeeded
  Next check: Verify package.json engines field

H3: Network timeout [3%] ░░░░░░░░░░
  Evidence: No timeout indicators found
  Disconfirming: No network-related errors
  Next check: Check external service status

[SELECTED] H1: Environment variable missing
```

**How to Capture:**
```bash
# Run with colored output
copilot-guardian run \
  --repo flamehaven/copilot-guardian-demo \
  --last-failed \
  --show-reasoning

# Use terminal with good color scheme (iTerm2, Hyper, or Windows Terminal)
# Zoom terminal to 140% for readability
# Screenshot immediately after hypothesis display
```

**Why It Wins:**
- Shows Copilot exploring 3 theories (not just one answer)
- Visual confidence bars are eye-catching
- Evidence-based reasoning is transparent
- Demonstrates meta-cognitive AI

**Caption for DEV.to:**
> "Copilot doesn't just guess - it explores 3 competing hypotheses with confidence scores and evidence. This is transparent reasoning."

---

### Screenshot 2: Patch Spectrum with NO-GO Badge ⭐⭐⭐⭐⭐

**What to Capture:**
```
Terminal showing:

=== PATCH SPECTRUM ===

CONSERVATIVE       [GO]   risk=low    +2 lines (env vars only)
  patch:   .copilot-guardian/fix.conservative.patch
  review:  .copilot-guardian/quality.conservative.json

BALANCED           [GO]   risk=low    +5 lines (env + NODE_ENV)
  patch:   .copilot-guardian/fix.balanced.patch
  review:  .copilot-guardian/quality.balanced.json

AGGRESSIVE         [NO-GO] risk=high  +47 lines (over-engineered) [SLOP: 73%]
  patch:   .copilot-guardian/fix.aggressive.patch
  review:  .copilot-guardian/quality.aggressive.json

[RECOMMENDED] conservative
```

**How to Capture:**
```bash
copilot-guardian run \
  --repo flamehaven/copilot-guardian-demo \
  --last-failed \
  --show-options

# Make sure the NO-GO badge is bright red
# Capture with SLOP indicator visible
```

**Why It Wins:**
- Shows AI offering choices (not commands)
- Red NO-GO badge is visually striking
- SLOP detection is unique differentiator
- Demonstrates Sovereign AI principle

**Caption for DEV.to:**
> "Three patch strategies with different risk profiles. The Aggressive patch gets flagged for over-engineering - AI checking AI for slop."

---

### Screenshot 3: Reasoning Trace JSON Audit ⭐⭐⭐⭐

**What to Capture:**
```json
// VS Code showing: .copilot-guardian/reasoning_trace.json

{
  "timestamp": "2026-01-24T05:30:00.000Z",
  "run_id": 12345678,
  "hypotheses": [
    {
      "id": "H1",
      "title": "Environment variable missing",
      "category": "environment",
      "confidence": 0.89,
      "evidence": [
        "Error log contains 'API_URL is required but was not found'",
        "No environment variables defined in test step"
      ],
      "disconfirming": [],
      "next_check": "Review workflow env section"
    },
    // ... H2, H3
  ],
  "selected": "H1",
  "final_diagnosis": {
    "category": "environment",
    "root_cause": "Workflow test step requires API_URL environment variable but it is not provided",
    "confidence": {
      "score": 0.89,
      "rationale": "Error message explicitly states missing variable name"
    }
  }
}
```

**How to Capture:**
1. Open `.copilot-guardian/reasoning_trace.json` in VS Code
2. Expand JSON structure
3. Highlight the "hypotheses" array
4. Use VS Code's JSON formatting (pretty print)
5. Screenshot with dark theme for professional look

**Why It Wins:**
- Proves complete transparency
- Shows structured, auditable AI reasoning
- Technical credibility boost
- "Receipts, not magic" principle

**Caption for DEV.to:**
> "Every Copilot decision is saved as structured JSON. You can audit the entire reasoning process - no black boxes."

---

### Screenshot 4: Interactive Debug Conversation ⭐⭐⭐⭐

**What to Capture:**
```
Terminal showing:

=== INTERACTIVE DEBUG MODE ===

Copilot: "I've analyzed the failure. Root cause: Missing API_URL"

What would you like to do?
  1) Ask Copilot follow-up questions
  2) Generate patch options immediately
  3) Show alternative hypotheses in detail
  4) Exit

Your choice (1-4): 1

You: Could this be a permissions issue instead?

Copilot: "Unlikely. The error explicitly states 'Environment variable 
[API_URL] is required but was not found', which is an environment 
configuration error, not a permissions error. Permissions issues 
typically manifest as 'Access denied' or 'Permission denied' messages. 
The workflow has sufficient permissions to run npm test - the issue 
is specifically about the missing environment variable."

You: What if API_URL was set in GitHub Secrets?

Copilot: "Even if API_URL exists in GitHub Secrets, it must be 
explicitly passed to the workflow step via the 'env:' section. 
Secrets are not automatically available to steps. You need to add:

env:
  API_URL: ${{ secrets.API_URL }}

However, I recommend using a test/placeholder value for CI rather 
than consuming production secrets."
```

**How to Capture:**
```bash
copilot-guardian debug \
  --repo flamehaven/copilot-guardian-demo \
  --last-failed

# Choose option 1
# Ask 2-3 follow-up questions
# Let Copilot respond naturally
# Screenshot the conversation
```

**Why It Wins:**
- Shows Copilot as collaborative partner (not just tool)
- Demonstrates context-aware responses
- Proves interactive debugging works
- Human-AI collaboration in action

**Caption for DEV.to:**
> "Debug mode lets you ask Copilot follow-up questions. It's like pair programming with an AI that remembers the full context."

---

## 🎨 Cover Image Design Specifications

### Recommended Approach: AI-Generated with Manual Polish

**DALL-E / Midjourney Prompt:**
```
A sleek, futuristic terminal interface showing glowing code and AI analysis, 
with a cyber-shield icon in the center. Title text "Beyond the Red X" in 
modern sans-serif font. Dark blue and purple gradient background (GitHub 
Copilot colors). Cinematic lighting with soft glow effects. Professional 
DevOps aesthetic. High contrast, clean composition. 16:9 aspect ratio.
```

**Alternative: Figma/Canva Template**

Layout:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│   [Terminal Icon]                               │
│                                                 │
│   BEYOND THE RED X                              │
│   AI That Debugs With You, Not For You         │
│                                                 │
│   [Snippet of colored terminal output]          │
│   > H1: Environment variable missing [89%]      │
│   > ████████░░                                  │
│                                                 │
│   GitHub Copilot CLI Challenge                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Color Palette:**
- Primary: #24292E (GitHub dark)
- Accent 1: #7B61FF (Copilot purple)
- Accent 2: #58A6FF (GitHub blue)
- Highlight: #F85149 (Error red for contrast)
- Background: Linear gradient from #1F2937 to #111827

**Dimensions:**
- 1000 x 420 px (DEV.to recommended)
- PNG format with transparency if possible

---

## 📊 Screenshot Capture Checklist

### Before Capturing

- [ ] Terminal color scheme set to high contrast (recommend "Dracula" or "One Dark Pro")
- [ ] Terminal font size at 14-16pt (readable in screenshots)
- [ ] Window width: 100-120 characters
- [ ] Clean terminal (no previous commands visible)
- [ ] Zoom browser/terminal to 125-150% for clarity

### Tools Recommended

**macOS:**
- Cmd+Shift+4: Native screenshot (space bar for window capture)
- CleanShot X: Professional screenshot tool with annotations
- Shottr: Free, fast, with markup

**Windows:**
- Win+Shift+S: Snipping tool
- ShareX: Free, powerful screenshot tool
- Greenshot: Open source alternative

**Linux:**
- Flameshot: Feature-rich screenshot tool
- Spectacle: KDE screenshot utility
- GNOME Screenshot: Built-in option

### Post-Processing

1. **Crop**: Remove unnecessary margins
2. **Annotate** (optional): Add arrows/highlights for key elements
3. **Compress**: Use TinyPNG to reduce file size without quality loss
4. **Format**: Save as PNG for best quality

---

## 🎬 Demo Video Script (90 seconds)

### Storyboard

**0:00-0:15 - The Hook**
```
[Screen: GitHub Actions failure page]
Narrator: "Your CI failed. You need answers, not just fixes."

[Terminal appears]
$ gh run list --status failure --limit 1

[Output shows failed run]
Narrator: "Most tools give you one answer. copilot-guardian shows you 
how it thinks."
```

**0:15-0:35 - Multi-Hypothesis**
```
[Run copilot-guardian with --show-reasoning]

[Hypotheses appear one by one with animation]
H1: Environment variable missing [89%] ████████░░
H2: Node version mismatch [8%] █░░░░░░░░░
H3: Network timeout [3%] ░░░░░░░░░░

Narrator: "Copilot explores three theories. H1 wins with 89% confidence 
based on evidence from the error logs."
```

**0:35-0:60 - Patch Spectrum**
```
[Show patch options]

CONSERVATIVE  [GO]    +2 lines
BALANCED      [GO]    +5 lines
AGGRESSIVE    [NO-GO] +47 lines [SLOP: 73%]

Narrator: "You choose the risk level. Conservative, Balanced, or 
Aggressive. The over-engineered patch gets flagged automatically - 
AI checking AI for slop."
```

**0:60-0:80 - The Receipts**
```
[Quick montage of files]
ls .copilot-guardian/

reasoning_trace.json
fix.conservative.patch
quality.conservative.json
copilot.analysis.raw.txt

Narrator: "Every Copilot response is saved. Every decision is auditable. 
No black boxes."
```

**0:80-0:90 - The Tagline**
```
[Screen fades to logo and title]

copilot-guardian
Beyond the Red X

"Trust isn't built on magic.
It's built on receipts."

GitHub Copilot CLI Challenge
github.com/flamehaven/copilot-guardian
```

### Recording Tips

1. **Use Asciinema** for authentic terminal recording
2. **Add narration separately** using Audacity/GarageBand
3. **Keep transitions smooth** with 1-2 second fades
4. **Export at 1080p** minimum for clarity
5. **Host on YouTube** for easy embedding

---

## ✅ Final Pre-Submission Checklist

### Sovereign AI Verification

- [ ] All secrets redacted before Copilot sees logs (`***REDACTED***`)
- [ ] No shell execution by Copilot (read-only mode)
- [ ] Patches saved locally, require manual `git apply`
- [ ] User maintains control at every decision point
- [ ] All Copilot responses saved as `.raw.txt` for transparency

### Technical Verification

- [ ] `npm install` works without errors
- [ ] `npm run build` compiles successfully
- [ ] Demo repo workflow fails reliably
- [ ] All 4 screenshots captured and optimized
- [ ] Cover image designed and exported
- [ ] Demo video recorded and uploaded

### Content Verification

- [ ] DEV.to submission reviewed for typos
- [ ] Code snippets tested and accurate
- [ ] Repository links verified
- [ ] All claims in submission are truthful
- [ ] No exaggeration or misleading statements

### Final Touch

- [ ] Read submission aloud to check flow
- [ ] Preview on DEV.to before publishing
- [ ] Get feedback from one trusted reviewer
- [ ] Submit 24-48 hours before deadline (buffer for issues)

---

## 🎯 Priority Actions (Next 2 Hours)

1. **Update demo repo** with enhanced error messages (DONE ✓)
2. **Capture 4 hero screenshots** following guide above
3. **Design cover image** using provided specifications
4. **Test complete flow** end-to-end one more time
5. **Review DEV_SUBMISSION.md** for any final tweaks

**After that, you're ready to submit and win.** 🏆
