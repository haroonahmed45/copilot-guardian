# Implementation Guide (for judges)

This guide helps you reproduce the full *"Beyond the Red X"* demo quickly.

## Prereqs
- Node.js >= 18
- GitHub CLI `gh` installed and authenticated
- GitHub Copilot CLI extension enabled (`gh copilot --version`)

## 1) Prepare demo repo

```bash
gh repo clone flamehaven/copilot-guardian-demo
cd copilot-guardian-demo
npm install

git commit --allow-empty -m "trigger CI" || true
git push
```

This repo intentionally fails CI because `API_URL` is required by tests but missing from the workflow.

## 2) Run copilot-guardian

```bash
cd ../copilot-guardian
npm install
npm run build

npx ./dist/cli.js run --repo flamehaven/copilot-guardian-demo --last-failed --show-reasoning --show-options
```

## 3) Verify artifacts

```bash
ls -la .copilot-guardian/
cat .copilot-guardian/reasoning_trace.json
cat .copilot-guardian/patch_options.json
cat .copilot-guardian/fix.conservative.patch
cat .copilot-guardian/quality_review.conservative.json
```

## 4) Optional: interactive mode

```bash
npx ./dist/cli.js debug --repo flamehaven/copilot-guardian-demo --last-failed
```

