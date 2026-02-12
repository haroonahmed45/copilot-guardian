<div align="center">

<img src="docs/Logo.png" alt="Copilot Guardian Logo" width="400"/>

# Copilot Guardian

Deterministic safety layer for Copilot-driven CI healing.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/flamehaven01/copilot-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/flamehaven01/copilot-guardian/actions/workflows/ci.yml)
[![Version: 0.2.6](https://img.shields.io/badge/version-0.2.6-blue.svg?style=flat-square)](https://github.com/flamehaven01/copilot-guardian/releases)
[![Release: v0.2.6](https://img.shields.io/badge/release-v0.2.6-0A66C2.svg?style=flat-square)](https://github.com/flamehaven01/copilot-guardian/releases/tag/v0.2.6)
[![Copilot CLI Challenge](https://img.shields.io/badge/GitHub-Copilot_Challenge-181717.svg?style=flat-square&logo=github&logoColor=white)](https://dev.to/challenges/github-2026-01-21)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Enabled-FF5722.svg?style=flat-square)](https://modelcontextprotocol.io/)

[Why Challenge](#why-this-is-a-copilot-cli-challenge-submission) • [Judge Quick Test](#judge-quick-test-90-seconds) • [Final GIF](#final-gif-slot-submission-finalization) • [Quick Start](#quick-start) • [How It Works](#how-it-works) • [Docs](#documentation-links)

</div>

---

## Why This Is a Copilot CLI Challenge Submission

This project demonstrates five advanced Copilot usage patterns under real CI failures:

1. Multi-hypothesis reasoning with explicit confidence and evidence
2. Patch synthesis across conservative, balanced, and aggressive strategies
3. Deterministic fail-closed guardrails against slop and bypass patterns
4. MCP-enriched context to improve diagnosis quality
5. Transparent artifact trail (`analysis.json`, raw responses, patch index)

Runtime clarification:
- Production path uses `@github/copilot-sdk`
- CLI fallback is for local experimentation only

---

## Judge Quick Test (90 seconds)

```bash
copilot-guardian run \
  --repo flamehaven01/copilot-guardian \
  --last-failed \
  --show-options \
  --fast \
  --max-log-chars 20000
```

Expected:
1. Structured diagnosis in `analysis.json`
2. Patch spectrum in `patch_options.json`
3. Safety verdicts in `quality_review.*.json`

For extended trace mode (slower), add `--show-reasoning`.

---

## Final GIF Slot (Submission Finalization)

Final demo artifact:

![Judge Quick Test Demo](docs/screenshots/final-demo.gif)

Runtime: 3m43s, Profile: --fast --max-log-chars 20000 (reasoning hidden for stable demo)

---

## Forced Abstain Policy (NOT PATCHABLE)

Guardian intentionally abstains for non-patchable failure classes such as:
- `401/403` auth failures
- token permission errors
- API rate-limit or infra-unavailable patterns

When abstaining, `abstain.report.json` is emitted and patch generation is skipped.

---

## Copilot Challenge Showcase: Five Advanced Usage Patterns

1. Multi-turn structured reasoning
2. Schema-constrained JSON outputs
3. Risk-calibrated generation
4. Independent validation loop
5. Fail-closed enforcement

Why this matters: AI slop in CI can produce green-looking but unsafe results.

---

## Quick Start

### Prerequisites

- Node.js >=18
- GitHub CLI (`gh`) authenticated
- GitHub Copilot subscription (SDK access)

### Installation

```bash
npm install -g copilot-guardian
# or
npx copilot-guardian --help
```

### Core Commands

```bash
# Stable demo profile
copilot-guardian run \
  --repo owner/repo \
  --last-failed \
  --show-options \
  --fast \
  --max-log-chars 20000

# Analysis only
copilot-guardian analyze \
  --repo owner/repo \
  --run-id <run_id> \
  --fast \
  --max-log-chars 20000

# Evaluate multiple failed runs
copilot-guardian eval \
  --repo owner/repo \
  --failed-limit 5 \
  --fast \
  --max-log-chars 50000

# Interactive follow-up
copilot-guardian debug \
  --repo owner/repo \
  --last-failed
```

---

## How It Works

Full architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

```mermaid
graph TB
    A[GitHub Actions Failure] --> B[Guardian CLI]
    B --> C[Context Fetch]
    C --> D[Multi-Hypothesis Analysis]
    D --> E[Copilot SDK]
    E --> F[Patch Strategies]
    F --> G[Deterministic Quality Guard]
    G --> H{GO?}
    H -->|NO_GO| I[Reject and Re-diagnose]
    H -->|GO| J[Patch Candidate]
    J --> K[Safe Branch PR or Auto-Heal]
```

### Key Modules

| Layer | Module | Purpose |
|---|---|---|
| Detection | `src/engine/github.ts` | Collect failure context |
| Intelligence | `src/engine/analyze.ts` | Multi-hypothesis diagnosis |
| Decision | `src/engine/patch_options.ts` | Strategy generation |
| Validation | Deterministic + model review | Slop and bypass control |
| Action | `src/engine/auto-apply.ts` | Safe branch/PR workflow |

---

## Output Files

Artifacts are generated under `.copilot-guardian/`:

| File | Purpose |
|---|---|
| `analysis.json` | Diagnosis + selected hypothesis |
| `reasoning_trace.json` | Hypothesis trace |
| `patch_options.json` | Strategy index + verdicts |
| `fix.*.patch` | Patch files |
| `quality_review.*.json` | Per-strategy quality results |
| `abstain.report.json` | Forced abstain classification |
| `copilot.*.raw.txt` | Raw model output snapshots |

---

## Documentation Links

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Demo walkthrough: [examples/demo-failure/README.md](examples/demo-failure/README.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Security: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT License. See [LICENSE](LICENSE).

## Credits

Built by Flamehaven (Yun) for the [GitHub Copilot CLI Challenge](https://dev.to/challenges/github-2026-01-21).

---

Trust is built on receipts.
