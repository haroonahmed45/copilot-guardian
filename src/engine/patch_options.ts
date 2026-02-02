import path from "node:path";
import chalk from "chalk";

import { copilotChatAsync } from "./async-exec";
import {
  ensureDir,
  loadText,
  writeJson,
  writeText,
  extractJsonObject,
  validateJson
} from "./util";

type StrategyId = "conservative" | "balanced" | "aggressive";

export type PatchStrategy = {
  label: string;
  id: StrategyId;
  risk_level: "low" | "medium" | "high";
  summary: string;
  diff: string;
};

export type PatchOptions = {
  strategies: PatchStrategy[];
};

export type QualityReview = {
  verdict: "GO" | "NO_GO";
  reasons: string[];
  risk_level: "low" | "medium" | "high";
  slop_score: number;
  suggested_adjustments: string[];
};

async function copilotChat(input: string, context: string): Promise<string> {
  return copilotChatAsync(input, {
    spinnerText: `[>] ${context}...`
  });
}

export async function generatePatchOptions(analysisJson: any, outDir = path.join(process.cwd(), ".copilot-guardian")) {
  console.log(chalk.cyan('[>] Generating patch options...'));
  ensureDir(outDir);
  
  const prompt = loadText(path.join(process.cwd(), "prompts", "patch.options.v1.txt"));

  const input = `${prompt}\n\nANALYSIS_JSON:\n${JSON.stringify(analysisJson, null, 2)}`;
  const raw = await copilotChat(input, 'Generating 3 patch strategies');
  writeText(path.join(outDir, "copilot.patch.options.raw.txt"), raw);

  const obj = JSON.parse(extractJsonObject(raw)) as PatchOptions;
  
  try {
    validateJson(obj, path.join(process.cwd(), "schemas", "patch_options.schema.json"));
    console.log(chalk.green('✓ Patch options validated'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
  }

  // Write patch files
  console.log(chalk.dim('[>] Running quality reviews...'));
  const results: any[] = [];
  for (const strat of obj.strategies) {
    const patchPath = path.join(outDir, `fix.${strat.id}.patch`);
    writeText(patchPath, strat.diff.trim() + "\n");

    const quality = await qualityReview(analysisJson, strat, outDir);
    results.push({
      label: strat.label,
      id: strat.id,
      risk_level: quality.risk_level,
      verdict: quality.verdict,
      slop_score: quality.slop_score,
      patchPath,
      summary: strat.summary
    });
    
    const verdictColor = quality.verdict === 'GO' ? chalk.green : chalk.red;
    console.log(chalk.dim(`  ${strat.label.padEnd(15)}`), verdictColor(quality.verdict), chalk.dim(`slop=${quality.slop_score.toFixed(2)}`));
  }

  const index = { timestamp: new Date().toISOString(), results };
  writeJson(path.join(outDir, "patch_options.json"), index);
  
  console.log(chalk.green('✓ Patch options complete'));

  return { options: obj, index };
}

async function qualityReview(analysisJson: any, strat: PatchStrategy, outDir: string): Promise<QualityReview> {
  const prompt = loadText(path.join(process.cwd(), "prompts", "quality.v1.txt"));
  const input = `${prompt}\n\nINPUT:\n${JSON.stringify({
    intent: analysisJson?.patch_plan?.intent,
    allowed_files: analysisJson?.patch_plan?.allowed_files,
    strategy: strat.id,
    diff: strat.diff
  }, null, 2)}`;

  const raw = await copilotChat(input, `Quality review: ${strat.id}`);
  writeText(path.join(outDir, `copilot.quality.${strat.id}.raw.txt`), raw);

  const obj = JSON.parse(extractJsonObject(raw));
  
  try {
    validateJson(obj, path.join(process.cwd(), "schemas", "quality.schema.json"));
  } catch (error: any) {
    console.log(chalk.yellow(`[!] Quality schema warning for ${strat.id}:`), error.message);
  }

  writeJson(path.join(outDir, `quality_review.${strat.id}.json`), obj);
  return obj as QualityReview;
}
