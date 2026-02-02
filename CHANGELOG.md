# Changelog

All notable changes to Copilot Guardian will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-02-02

### Added
- **Core Analysis Engine**: Multi-hypothesis reasoning system for CI/CD failure root cause analysis
- **Patch Generation**: Three-strategy patch options (Conservative, Balanced, Aggressive) with risk assessment
- **Auto-Heal Mode**: Automated patch application with retry logic and CI verification
- **MCP Integration**: Model Context Protocol support for enhanced repository context
- **Anti-Slop Detection**: Quality scoring system to detect and flag AI-generated bloat
- **Sovereign AI Philosophy**: Full transparency with audit trails and user control
- **Beautiful CLI UI**: Color-coded dashboard with confidence indicators and progress spinners
- **Comprehensive Testing**: 43 tests covering async execution, analysis, patch generation, and auto-apply
- **Security Features**: Secret redaction, path validation, and safe file operations
- **GitHub Actions CI/CD**: Automated testing and build verification

### Features
- Fetch and analyze GitHub Actions failure logs via `gh` CLI
- Generate structured analysis with hypothesis ranking and confidence scores
- Create multiple patch strategies with quality verdicts
- Interactive patch selection or automatic lowest-risk application
- Real-time CI status monitoring with retry logic
- Deep context injection using repository structure and source code
- Debug mode for interactive troubleshooting
- Persistent audit logs for all AI interactions

### Documentation
- Complete README with architecture diagrams (Mermaid)
- API documentation and usage examples
- Security policy and vulnerability reporting guidelines
- Contributing guidelines for community collaboration
- Before/After impact analysis
- Visual storyboard and demo scenarios

### Technical Details
- **Language**: TypeScript 5.x
- **Runtime**: Node.js 18+
- **Dependencies**: 
  - GitHub CLI (`gh`) for repository integration
  - GitHub Copilot CLI for AI-powered analysis
  - Chalk, Ora for terminal UI
  - Jest for testing
- **Architecture**: Modular engine design with clear separation of concerns

### Known Limitations
- Requires GitHub CLI authentication (`gh auth login`)
- Requires GitHub Copilot CLI installation
- Auto-heal mode requires git repository context
- MCP configuration may override existing Copilot CLI settings

### Security
- All logs are sanitized before AI processing
- Path validation prevents directory traversal attacks
- No credentials stored in project files
- Audit trails maintained for compliance

---

**Full Changelog**: https://github.com/flamehaven01/copilot-guardian/commits/v0.0.1
