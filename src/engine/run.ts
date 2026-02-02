import path from "node:path";
import chalk from "chalk";

import { analyzeRun } from "./analyze";
import { generatePatchOptions } from "./patch_options";
import { ensureDir, writeJson, writeText } from "./util";

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
  
  console.log(chalk.dim(`\nAll artifacts saved to: ${outDir}`));

  return { analysis, patchIndex, outDir, ctx };
}
