# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |

## Security Philosophy

Copilot Guardian is designed with security-first principles:

### 1. Secret Redaction
All logs and context sent to AI models are automatically sanitized:
- GitHub tokens (`ghp_*`, `ghs_*`, `gho_*`)
- Bearer tokens
- API keys
- Passwords in error messages

### 2. Local-First Processing
- Log collection, redaction, and artifact persistence happen locally.
- Copilot requests are sent to GitHub Copilot via authenticated GitHub sessions, using `@github/copilot-sdk` by default.
- Optional `gh copilot` CLI flows are supported for terminal-first reproducible runs.
- Full audit trail maintained in `.copilot-guardian/` directory

### 3. Transparency
- All raw inputs and outputs are saved (`.raw.txt` files)
- Users can inspect exactly what data was sent to AI models
- No hidden third-party telemetry or data collection

## Reporting a Vulnerability

If you discover a security vulnerability in Copilot Guardian, please:

1. **DO NOT** open a public issue
2. Email: info@flamehaven.space
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline
- **24 hours**: Initial acknowledgment
- **7 days**: Detailed assessment and action plan
- **30 days**: Fix implementation and disclosure

## Security Best Practices for Users

### Authentication
```bash
# Ensure GitHub CLI is authenticated
gh auth status

# Use token with minimal required scopes
# Required: repo, workflow
```

### Environment Variables
```bash
# Never commit .env files
# Use GitHub Secrets for CI/CD environments
```

### Patch Review
```bash
# Always review patches before applying
copilot-guardian fix --interactive

# Use Conservative mode for production
# Review the "Quality Verdict" before accepting
```

## Known Limitations

### 1. GitHub CLI Security
- Guardian inherits gh CLI's authentication model
- Ensure `gh` is up to date: `gh version`

### 2. AI Model Limitations
- LLMs can hallucinate - always review patches
- Use the Anti-Slop quality checks
- Test patches in non-production environments first

### 3. Rate Limits
- GitHub API rate limits apply
- Copilot API rate limits apply
- Guardian implements exponential backoff

## Security Audit Trail

Every Guardian run creates:
```
.copilot-guardian/
├── [timestamp]-context.raw.txt    # What was sent to AI
├── [timestamp]-analysis.json      # AI response (structured)
└── [timestamp]-patches.json       # Generated patches
```

This enables:
- Post-incident forensics
- Compliance audits
- Privacy verification

## Data Privacy

### What Guardian Collects
- GitHub Actions logs (for analysis)
- Repository metadata (via gh CLI)
- Source code context (when using MCP)

### What Guardian DOES NOT Collect
- User credentials
- Unrelated source code
- Personal information
- Telemetry or usage statistics

### Data Retention
- All data is stored locally in `.copilot-guardian/`
- User controls retention (can delete directory)
- No cloud storage or external databases

## Compliance

### GDPR
- All processing is local
- No data transfer to third parties (except GitHub Copilot API via the user's authenticated SDK/CLI session)
- User has full control and right to erasure

### Enterprise Use
- Compatible with GitHub Enterprise
- Works within corporate firewalls
- No external dependencies beyond GitHub APIs

## Security Updates

Subscribe to security advisories:
```bash
gh repo subscribe flamehaven01/copilot-guardian --alerts
```

## Contact

- Security Issues: info@flamehaven.space
- General Issues: [GitHub Issues](https://github.com/flamehaven01/copilot-guardian/issues)
- Documentation: [docs/](./docs/)

---

**Last Updated**: 2026-02-13
**Security Policy Version**: 0.2.6
