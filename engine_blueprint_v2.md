# Project Blueprint

- Root: `D:\Sanctum\Flamehaven\STRUCTURA\Project\GITHUB COPLIOT CLI CHALLENGE\copilot-guardian\src\engine`  
- Generated: `2026-01-30 14:35:34`  
- Preset: `pro`  
- LLM mode: `summary`  
- Estimated tokens (prompt): `2127`  

## Directory Tree

```
D:\Sanctum\Flamehaven\STRUCTURA\Project\GITHUB COPLIOT CLI CHALLENGE\copilot-guardian\src\engine
|-- analyze.ts
|-- async-exec.ts
|-- debug.ts
|-- github.ts
|-- mcp.ts
|-- patch_options.ts
|-- run.ts
`-- util.ts
```


## File Contents

<!-- @A:15cb867b -->
### File: `analyze.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import chalk from "chalk";
- import { fetchRunContext, RunContext } from "./github";
- import { copilotChatAsync } from "./async-exec";
- import { ensureMCPConfigured, enhancePromptWithMCP, saveMCPUsageLog } from "./mcp";
- import {
-   ensureDir,
-   loadText,
-   writeJson,
-   writeText,
-   extractJsonObject,
-   validateJson
- } from "./util";
- export interface Hypothesis {
-   id: string;
-   title: string;
-   category: string;
-   confidence: number;
-   evidence: string[];
-   disconfirming: string[];
-   next_check: string;
- }
- export type AnalysisJson = {
-   metadata: {
-     repo: string;
-     run_id: number;
-     workflow_path?: string;
-     redacted: boolean;
-   };
-   failure_context: {
-     job: string;
-     step: string;
-     exit_code: number;
-     log_summary: string;
-   };
-   diagnosis: {
-     hypotheses: Hypothesis[];
```


<!-- @A:df71f812 -->
### File: `async-exec.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Medium`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import { spawn } from 'child_process';
- import ora, { Ora } from 'ora';
- import chalk from 'chalk';
- export interface ExecOptions {
-   showSpinner?: boolean;
-   spinnerText?: string;
-   timeout?: number;
-   retries?: number;
- }
- export class TimeoutError extends Error {
-   constructor(ms: number) {
-     super(`Operation timed out after ${ms}ms`);
-     this.name = 'TimeoutError';
-   }
- }
- export class RateLimitError extends Error {
-   constructor() {
-     super('GitHub API rate limit exceeded');
-     this.name = 'RateLimitError';
-   }
- }
- export class CopilotError extends Error {
-   constructor(message: string) {
-     super(`Copilot CLI error: ${message}`);
-     this.name = 'CopilotError';
-   }
- }
- /**
-  * Execute command asynchronously with optional spinner
-  */
- export async function execAsync(
-   command: string,
-   args: string[],
-   input?: string,
-   options: ExecOptions = {}
```


<!-- @A:6d034b89 -->
### File: `debug.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import { execSync } from "node:child_process";
- import readline from "node:readline/promises";
- import { stdin as input, stdout as output } from "node:process";
- import { analyzeRun } from "./analyze";
- import { generatePatchOptions } from "./patch_options";
- import { ensureDir, loadText, writeText, extractJsonObject, validateJson } from "./util";
- function copilotChat(payload: string): string {
-   try {
-     return execSync("gh copilot chat --quiet", {
-       input: payload,
-       stdio: ["pipe", "pipe", "pipe"],
-       encoding: "utf8"
-     }) as unknown as string;
-   } catch (e: any) {
-     const stderr = e?.stderr ? String(e.stderr) : "";
-     throw new Error(`Copilot CLI failed.\n${stderr}`);
-   }
- }
- export async function debugInteractive(repo: string, runId: number, outDir = path.join(process.cwd(), ".copilot-guardian")) {
-   ensureDir(outDir);
-   const { analysis, ctx } = await analyzeRun(repo, runId, outDir);
-   const rl = readline.createInterface({ input, output });
-   const transcriptPath = path.join(outDir, "debug.transcript.md");
-   writeText(transcriptPath, `# copilot-guardian debug transcript\n\nRepo: ${repo}\nRun: ${runId}\n\n`);
-   // Thin interactive layer: ask follow-ups, then optionally generate patch spectrum.
-   while (true) {
-     output.write("\nChoose an action:\n");
-     output.write("  1) Ask Copilot a follow-up question\n");
-     output.write("  2) Generate patch options (Conservative/Balanced/Aggressive)\n");
-     output.write("  3) Exit\n\n");
-     const choice = (await rl.question("Your choice (1-3): ")).trim();
```


<!-- @A:7b169300 -->
### File: `github.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import chalk from "chalk";
- import { ghAsync } from "./async-exec";
- import { redactSecrets, clampText } from "./util";
- export type RunContext = {
-   repo: string;
-   runId: number;
-   workflowPath?: string;
-   headSha?: string;
-   job?: string;
-   step?: string;
-   exitCode?: number;
-   logExcerpt: string;
-   logSummary: string;
-   workflowYaml?: string;
- };
- async function gh(args: string[]): Promise<string> {
-   return ghAsync(args, {
-     showSpinner: false,
-     timeout: 30000
-   });
- }
- export async function getLastFailedRunId(repo: string): Promise<number> {
-   const out = (await gh([
-     'run', 'list',
-     '--repo', repo,
-     '--status', 'failure',
-     '--limit', '1',
-     '--json', 'databaseId',
-     '-q', '.[0].databaseId'
-   ])).trim();
-   const n = Number(out);
-   if (!Number.isFinite(n)) {
-     throw new Error(`Could not find failed run for ${repo}`);
-   }
-   return n;
- }
```


<!-- @A:24ca61ce -->
### File: `mcp.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import fs from 'fs';
- import path from 'path';
- import os from 'os';
- import chalk from 'chalk';
- import { execSync } from 'child_process';
- export interface MCPConfig {
-   mcpServers: {
-     github: {
-       command: string;
-       args: string[];
-       env: {
-         GITHUB_TOKEN: string;
-       };
-     };
-   };
- }
- /**
-  * Check if GitHub MCP server is configured
-  */
- export function isMCPConfigured(): boolean {
-   const configPath = getMCPConfigPath();
-   if (!fs.existsSync(configPath)) {
-     return false;
-   }
-   try {
-     const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
-     return config.mcpServers?.github !== undefined;
-   } catch {
-     return false;
-   }
- }
- /**
-  * Get MCP config file path
-  */
- function getMCPConfigPath(): string {
```


<!-- @A:cb5001ff -->
### File: `patch_options.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import chalk from "chalk";
- import { copilotChatAsync } from "./async-exec";
- import {
-   ensureDir,
-   loadText,
-   writeJson,
-   writeText,
-   extractJsonObject,
-   validateJson
- } from "./util";
- type StrategyId = "conservative" | "balanced" | "aggressive";
- export type PatchStrategy = {
-   label: string;
-   id: StrategyId;
-   risk_level: "low" | "medium" | "high";
-   summary: string;
-   diff: string;
- };
- export type PatchOptions = {
-   strategies: PatchStrategy[];
- };
- export type QualityReview = {
-   verdict: "GO" | "NO_GO";
-   reasons: string[];
-   risk_level: "low" | "medium" | "high";
-   slop_score: number;
-   suggested_adjustments: string[];
- };
- async function copilotChat(input: string, context: string): Promise<string> {
-   return copilotChatAsync(input, {
-     spinnerText: `[>] ${context}...`
-   });
- }
```


<!-- @A:7bb7a8e1 -->
### File: `run.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import chalk from "chalk";
- import { analyzeRun } from "./analyze";
- import { generatePatchOptions } from "./patch_options";
- import { ensureDir, writeJson, writeText } from "./util";
- export type RunFlags = {
-   showReasoning?: boolean;
-   showOptions?: boolean;
-   strategy?: "conservative" | "balanced" | "aggressive";
-   outDir?: string;
- };
- export async function runGuardian(repo: string, runId: number, flags: RunFlags) {
-   const outDir = flags.outDir || path.join(process.cwd(), ".copilot-guardian");
-   ensureDir(outDir);
-   console.log(chalk.bold.cyan('\n=== Copilot Guardian Analysis ===\n'));
-   const { analysisPath, analysis, ctx } = await analyzeRun(repo, runId, outDir);
-   // Default: generate options only if requested (for speed)
-   let patchIndex: any | undefined;
-   if (flags.showOptions) {
-     const { index } = await generatePatchOptions(analysis, outDir);
-     patchIndex = index;
-   }
-   // Save a small summary report
-   const report = {
-     timestamp: new Date().toISOString(),
-     repo,
-     runId,
-     analysisPath,
-     patchIndexPath: flags.showOptions ? path.join(outDir, "patch_options.json") : null,
-     redacted: true
-   };
-   writeJson(path.join(outDir, "guardian.report.json"), report);
```


<!-- @A:84f024fd -->
### File: `util.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Standard Code"
- import fs from "node:fs";
- import path from "node:path";
- import Ajv from "ajv";
- import addFormats from "ajv-formats";
- export type ExecOptions = {
-   cwd?: string;
-   input?: string;
-   env?: NodeJS.ProcessEnv;
-   stdio?: "pipe" | "inherit";
- };
- export function ensureDir(dir: string): void {
-   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
- }
- export function loadText(p: string): string {
-   return fs.readFileSync(p, "utf8");
- }
- export function writeText(p: string, content: string): void {
-   ensureDir(path.dirname(p));
-   fs.writeFileSync(p, content, "utf8");
- }
- export function writeJson(p: string, obj: unknown): void {
-   writeText(p, JSON.stringify(obj, null, 2));
- }
- export function redactSecrets(text: string): string {
-   const patterns: RegExp[] = [
-     /ghp_[a-zA-Z0-9]{36}/g,
-     /gho_[a-zA-Z0-9]{36}/g,
-     /github_pat_[a-zA-Z0-9_]{82}/g,
-     /ghs_[a-zA-Z0-9]{36}/g,
-     /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
-     /sk-[a-zA-Z0-9]{48}/g,
-     /(token|password|secret|key)\s*[:=]\s*[^\s]+/gi,
-     /\b[A-Za-z0-9+/]{40,}\b/g
```


## Navigation Pack

| path | role | entry_points | critical_flow | signals |
|---|---|---|---|---|
| analyze.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| async-exec.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| debug.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| github.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| mcp.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| patch_options.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| run.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| util.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=false, has_router=false |
## Spicy Review
- Spicy Level: [o]  score=0/100
- Counts: {'ok': 1, 'warn': 0, 'risk': 0, 'high': 0, 'critical': 0}
- Findings: none