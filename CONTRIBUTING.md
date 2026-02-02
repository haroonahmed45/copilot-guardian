# Contributing

Thanks for taking a look at **copilot-guardian**.

## Scope
This repository is intentionally focused on **terminal-first, auditable Copilot CLI workflows**:
- Multi-hypothesis analysis
- Risk-aware patch generation (3 strategies)
- Anti-slop quality review
- Transparent artifact logging

## Development

```bash
npm install
npm run build
node dist/cli.js --help
```

## Safety rules
- Do **not** add auto-apply, auto-commit, or auto-push behavior.
- Keep redaction **on by default**.
- Avoid insecure workarounds (e.g., disabling SSL, `continue-on-error`).

## PR guidelines
- Keep diffs small and explain intent.
- If you modify prompts, include an example `.copilot-guardian/` artifact set for validation.

