# Project Blueprint

- Root: `D:\Sanctum\Flamehaven\STRUCTURA\Project\GITHUB COPLIOT CLI CHALLENGE\copilot-guardian\src\engine`  
- Generated: `2026-01-30 13:56:15`  
- Preset: `pro`  
- LLM mode: `summary`  
- Estimated tokens (prompt): `1727`  

## Directory Tree

```
D:\Sanctum\Flamehaven\STRUCTURA\Project\GITHUB COPLIOT CLI CHALLENGE\copilot-guardian\src\engine
|-- analyze.ts
|-- debug.ts
|-- github.ts
|-- patch_options.ts
|-- run.ts
`-- util.ts
```


## File Contents

<!-- @A:bf43a85d -->
### File: `analyze.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import { execSync } from "node:child_process";
- import { fetchRunContext, RunContext } from "./github";
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
-     selected_hypothesis_id: string;
-     category: string;
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


<!-- @A:313ac997 -->
### File: `github.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Standard Code"
- import { execSync } from "node:child_process";
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
- function gh(cmd: string, opts?: { input?: string }): string {
-   try {
-     return execSync(cmd, {
-       stdio: ["pipe", "pipe", "pipe"],
-       input: opts?.input,
-       encoding: "utf8"
-     }) as unknown as string;
-   } catch (e: any) {
-     const stderr = e?.stderr ? String(e.stderr) : "";
-     const msg = `gh command failed: ${cmd}\n${stderr}`;
-     throw new Error(msg);
-   }
- }
- export function getLastFailedRunId(repo: string): number {
-   const out = gh(
-     `gh run list --repo ${repo} --status failure --limit 1 --json databaseId -q ".[0].databaseId"`
-   ).trim();
-   const n = Number(out);
-   if (!Number.isFinite(n)) throw new Error(`Could not determine last failed run id for ${repo}`);
-   return n;
- }
- export function fetchRunContext(repo: string, runId: number, maxLogChars = 12000): RunContext {
```


<!-- @A:b47bccaf -->
### File: `patch_options.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
- import { execSync } from "node:child_process";
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
- function copilotChat(input: string): string {
-   try {
-     return execSync("gh copilot chat --quiet", {
-       input,
-       stdio: ["pipe", "pipe", "pipe"],
-       encoding: "utf8"
```


<!-- @A:2133c653 -->
### File: `run.ts`

```markdown

> **!! [LOGOS-AI-NOTE]**
> *   **Role:** `Kernel/Core` | **Criticality:** `Low`
> *   **Intent:** "Component implementation for system logic."
> *   **Constraints:** "Async-IO"
- import path from "node:path";
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
-   return { analysis, patchIndex, outDir, ctx };
- }
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
| debug.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| github.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=false, has_router=false |
| patch_options.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| run.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=true, has_router=false |
| util.ts | Kernel/Core | - | - | has_main_guard=false, has_main_func=false, has_cli_framework=false, has_web_app=false, has_async=false, has_router=false |
## Spicy Review
- Spicy Level: [o]  score=0/100
- Counts: {'ok': 1, 'warn': 0, 'risk': 0, 'high': 0, 'critical': 0}
- Findings: none