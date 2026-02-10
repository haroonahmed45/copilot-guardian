import path from "node:path";
import chalk from "chalk";

import { analyzeRun } from "./analyze.js";
import { generatePatchOptions } from "./patch_options.js";
import { ensureDir, writeJson, writeText } from "./util.js";

export type RunFlags = {
  showReasoning?: boolean;
  showOptions?: boolean;
  strategy?: "conservative" | "balanced" | "aggressive";
  outDir?: string;
};

export async function runGuardian(repo: string, runId: number, flags: RunFlags) {
  const outDir = flags.outDir || path.join(process.cwd(), ".copilot-guardian");
  ensureDir(outDir);
  
  console.log(chalk.bold.cyan('\n=== Copilot Guardian Analysis ===\n'));
  console.log(chalk.dim(`Repository: ${repo}`));
  console.log(chalk.dim(`Run ID: ${runId}`));
  console.log(chalk.dim(`Output: ${outDir}\n`));

  const { analysisPath, analysis, ctx } = await analyzeRun(repo, runId, outDir);

  // Default: generate options only if requested (for speed)
  let patchIndex: any | undefined;
  if (flags.showOptions) {
    const { index } = await generatePatchOptions(analysis, outDir);
    patchIndex = index;
  }

  // Save a small summary report
  const report = {
    timestamp: new Date().toISOString(),
    repo,
    runId,
    analysisPath,
    patchIndexPath: flags.showOptions ? path.join(outDir, "patch_options.json") : null,
    redacted: true
  };
  writeJson(path.join(outDir, "guardian.report.json"), report);
  
  console.log(chalk.green.bold('\n=== Guardian Complete ==='));
  console.log(chalk.dim(`All artifacts saved to: ${outDir}`));
  console.log(chalk.dim('\nGenerated files:'));
  console.log(chalk.dim('  - analysis.json (multi-hypothesis results)'));
  console.log(chalk.dim('  - reasoning_trace.json (audit trail)'));
  console.log(chalk.dim('  - copilot.analysis.raw.txt (full Copilot response)'));
  if (flags.showOptions) {
    console.log(chalk.dim('  - fix.*.patch (3 patch strategies)'));
    console.log(chalk.dim('  - patch_options.json (quality review results)'));
  }
  console.log("");

  return { analysis, patchIndex, outDir, ctx };
}
