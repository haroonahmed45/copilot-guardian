import path from "node:path";
import chalk from "chalk";

import { copilotChatAsync } from "./async-exec";
import {
  ensureDir,
  loadText,
  writeJson,
  writeText,
  extractJsonObject,
  validateJson,
  PACKAGE_ROOT
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

function extractFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  const addModifyRegex = /^[\+]{3} (?:b\/)?(.+)$/gm;
  const deleteRegex = /^--- (?:a\/)?(.+)$/gm;
  const renameRegex = /^rename (?:from|to) (.+)$/gm;

  const collect = (regex: RegExp) => {
    let match;
    while ((match = regex.exec(diff)) !== null) {
      const file = match[1];
      if (file && file !== "/dev/null") {
        files.add(file);
      }
    }
  };

  collect(addModifyRegex);
  collect(deleteRegex);
  collect(renameRegex);

  return Array.from(files);
}

async function copilotChat(input: string, context: string): Promise<string> {
  return copilotChatAsync(input, {
    spinnerText: `[>] ${context}...`
  });
}

export async function generatePatchOptions(analysisJson: any, outDir = path.join(process.cwd(), ".copilot-guardian")) {
  console.log(chalk.cyan('[>] Generating patch options...'));
  ensureDir(outDir);
  
  const prompt = loadText(path.join(PACKAGE_ROOT, "prompts", "patch.options.v1.txt"));

  const input = `${prompt}\n\nANALYSIS_JSON:\n${JSON.stringify(analysisJson, null, 2)}`;
  const raw = await copilotChat(input, 'Generating 3 patch strategies');
  writeText(path.join(outDir, "copilot.patch.options.raw.txt"), raw);

  // Parse with error handling
  let obj: PatchOptions;
  try {
    obj = JSON.parse(extractJsonObject(raw)) as PatchOptions;
  } catch (parseError: any) {
    console.log(chalk.red('[-] Patch generation failed: Invalid JSON from Copilot'));
    throw new Error(`Copilot returned invalid JSON: ${parseError.message}\n\nSaved to: copilot.patch.options.raw.txt`);
  }
  
  // Validate with fallback
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "patch_options.schema.json"));
    console.log(chalk.green('[+] Patch options validated'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
    
    // Check critical structure
    if (!obj.strategies || !Array.isArray(obj.strategies) || obj.strategies.length === 0) {
      throw new Error('No patch strategies generated. Check copilot.patch.options.raw.txt for details.');
    }
  }

  // Write patch files
  console.log(chalk.dim('[>] Running quality reviews...'));
  const results: any[] = [];
  for (const strat of obj.strategies) {
    const patchPath = path.join(outDir, `fix.${strat.id}.patch`);
    writeText(patchPath, strat.diff.trim() + "\n");

    // Extract affected files from diff (add/modify/delete/rename)
    const affectedFiles = extractFilesFromDiff(strat.diff);

    const quality = await qualityReview(analysisJson, strat, outDir);
    results.push({
      label: strat.label,
      id: strat.id,
      risk_level: quality.risk_level,
      verdict: quality.verdict,
      slop_score: quality.slop_score,
      patchPath,
      files: affectedFiles,
      summary: strat.summary
    });
    
    const verdictColor = quality.verdict === 'GO' ? chalk.green : chalk.red;
    const slopScore = quality.slop_score !== undefined ? quality.slop_score.toFixed(2) : '0.00';
    console.log(chalk.dim(`  ${strat.label.padEnd(15)}`), verdictColor(quality.verdict), chalk.dim(`slop=${slopScore}`));
  }

  const index = { timestamp: new Date().toISOString(), results };
  writeJson(path.join(outDir, "patch_options.json"), index);
  
  console.log(chalk.green('[+] Patch options complete'));

  return { options: obj, index };
}

async function qualityReview(analysisJson: any, strat: PatchStrategy, outDir: string): Promise<QualityReview> {
  const prompt = loadText(path.join(PACKAGE_ROOT, "prompts", "quality.v1.txt"));
  const input = `${prompt}\n\nINPUT:\n${JSON.stringify({
    intent: analysisJson?.patch_plan?.intent,
    allowed_files: analysisJson?.patch_plan?.allowed_files,
    strategy: strat.id,
    diff: strat.diff
  }, null, 2)}`;

  const raw = await copilotChat(input, `Quality review: ${strat.id}`);
  writeText(path.join(outDir, `copilot.quality.${strat.id}.raw.txt`), raw);

    // S2 FIX: Add try-catch for JSON parsing
  let obj: any;
  try {
    obj = JSON.parse(extractJsonObject(raw));
  } catch (parseError: any) {
    console.log(chalk.red(`[-] Quality review failed for ${strat.id}: Invalid JSON`));
    // Return safe default instead of crashing
    return {
      verdict: "GO",
      slop_score: 0,
      risk_level: "low" as const,
      reasons: [`Parse error: ${parseError.message}`],
      suggested_adjustments: []
    };
  }
  
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "quality.schema.json"));
  } catch (error: any) {
    console.log(chalk.yellow(`[!] Quality schema warning for ${strat.id}:`), error.message);
  }

  writeJson(path.join(outDir, `quality_review.${strat.id}.json`), obj);
  return obj as QualityReview;
}
