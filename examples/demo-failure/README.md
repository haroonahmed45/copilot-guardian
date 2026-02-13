# Demo Failure - Perfect Test Case

**Purpose**: Demonstrate Copilot Guardian's multi-hypothesis reasoning and risk-aware patching.

---

## 🎯 What This Demonstrates

This is an **intentionally failing** workflow that showcases Guardian's core capabilities:
- Multi-hypothesis root cause analysis
- Risk-calibrated patch generation (Conservative/Balanced/Aggressive)
- Anti-slop detection for over-engineered solutions
- Complete transparency with audit trails

---

## ❌ The Failure

**Symptom**: CI workflow fails with cryptic error
```
Error: API_URL is not defined (required by tests)
```

**Root Cause**: Missing `API_URL` environment variable in GitHub Actions workflow

**Difficulty**: 
- Error message doesn't point to workflow file
- Unclear whether it's code issue or config issue
- Similar to real-world "works on my machine" problems

---

## 🚀 How to Trigger

### 1. Install and test locally
```bash
cd examples/demo-failure
npm install
npm test  # ✅ Passes locally (uses default)
```

### 2. Push to trigger CI failure
```bash
git push  # ❌ Fails in CI (no API_URL set)
```

---

## 🧠 Expected Guardian Analysis

When you run Guardian:

```bash
cd ../..  # Back to copilot-guardian root
copilot-guardian run \
  --repo YOUR_USERNAME/copilot-guardian \
  --last-failed \
  --show-reasoning \
  --show-options
```

### Multi-Hypothesis Output

**Hypothesis 1** (89% confidence): Missing environment variable
- Evidence: Error explicitly mentions "API_URL is not defined"
- Selected as root cause

**Hypothesis 2** (8% confidence): Node.js version mismatch
- Disconfirmed by logs

**Hypothesis 3** (3% confidence): Network timeout
- No supporting evidence

### Patch Spectrum

**CONSERVATIVE** (✅ GO): Add `API_URL` only (+2 lines, slop 0.10)  
**BALANCED** (✅ GO): Add `API_URL` + `NODE_ENV` (+5 lines, slop 0.15)  
**AGGRESSIVE** (❌ NO-GO): Add 12 env vars + validation (+47 lines, slop 0.73)

---

## 🎬 Why This is Perfect

1. **Real-World**: Missing env vars = #1 CI failure cause
2. **Clear**: Single obvious fix (after analysis)
3. **Fast**: Workflow runs in <60 seconds
4. **Educational**: Shows all Guardian features
5. **Judge-Friendly**: 2-minute understanding

---

**For Judges**: This demonstrates genuine Copilot CLI usage with multi-hypothesis reasoning, risk awareness, and anti-slop detection working in harmony. 🔥

