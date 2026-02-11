import path from "node:path";
import chalk from "chalk";

import { copilotChatAsync } from "./async-exec.js";
import {
  ensureDir,
  loadText,
  writeJson,
  writeText,
  extractJsonObject,
  validateJson,
  PACKAGE_ROOT
} from "./util.js";

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

export type PatchGenerationOptions = {
  fast?: boolean;
  patchRetries?: number;
  patchTimeoutMs?: number;
  qualityTimeoutMs?: number;
  qualityParallel?: number;
  skipModelQualityOnDeterministicNoGo?: boolean;
};

type QualityReviewOptions = {
  timeoutMs?: number;
  skipModelOnDeterministicNoGo?: boolean;
};

const RISK_RANK: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").trim();
  const segments = normalized.split("/");
  let out = "^";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (segment === "**") {
      // "**/" should match zero or more directories.
      out += isLast ? ".*" : "(?:[^/]+/)*";
      continue;
    }

    let segOut = "";
    for (let j = 0; j < segment.length; j++) {
      const ch = segment[j];
      if (ch === "*") {
        segOut += "[^/]*";
      } else if (ch === "?") {
        segOut += "[^/]";
      } else if ("\\.[]{}()+-^$|".includes(ch)) {
        segOut += `\\${ch}`;
      } else {
        segOut += ch;
      }
    }

    out += segOut;
    if (!isLast) out += "/";
  }

  out += "$";
  return new RegExp(out);
}

function isAllowedByPatterns(filePath: string, allowedFiles: string[]): boolean {
  const normalizedFile = filePath.replace(/\\/g, "/");
  return allowedFiles.some((rawPattern) => {
    const pattern = String(rawPattern || "").trim().replace(/\\/g, "/");
    if (!pattern) return false;
    if (pattern === normalizedFile) return true;
    if (!pattern.includes("*") && !pattern.includes("?")) return false;
    return globToRegex(pattern).test(normalizedFile);
  });
}

function inferIntentKind(intent: string): "test" | "lint" | "build" | "install" | "unknown" {
  const i = String(intent || "").toLowerCase();
  if (i.includes("test")) return "test";
  if (i.includes("lint")) return "lint";
  if (i.includes("build") || i.includes("compile")) return "build";
  if (i.includes("install") || i.includes("dependency") || i.includes("npm ci")) return "install";
  return "unknown";
}

function computeAddedLines(diff: string): number {
  return diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .length;
}

function getAddedContent(diff: string): string {
  return diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function deterministicQualityReview(
  analysisJson: any,
  strat: PatchStrategy,
  affectedFiles: string[]
): QualityReview {
  const reasons: string[] = [];
  const suggestedAdjustments: string[] = [];
  const allowedFilesRaw = Array.isArray(analysisJson?.patch_plan?.allowed_files)
    ? analysisJson.patch_plan.allowed_files
    : [];
  const allowedFiles = allowedFilesRaw.filter((f: any) => typeof f === "string" && f.trim().length > 0);
  const intent = String(analysisJson?.patch_plan?.intent || "");
  const intentKind = inferIntentKind(intent);

  let score = 0;
  let forceNoGo = false;

  if (allowedFiles.length > 0 && affectedFiles.length > 0) {
    const outOfScope = affectedFiles.filter((file) => !isAllowedByPatterns(file, allowedFiles));
    if (outOfScope.length > 0) {
      score += 0.45;
      forceNoGo = true;
      reasons.push(`Out-of-scope file changes detected: ${outOfScope.join(", ")}`);
      suggestedAdjustments.push("Restrict patch to analysis.patch_plan.allowed_files scope.");
    }
  }

  const diff = String(strat.diff || "");
  const diffLower = diff.toLowerCase();
  const touchesWorkflowFiles = affectedFiles.some((file) => file.startsWith(".github/workflows/"));
  if (touchesWorkflowFiles) {
    score += 0.45;
    forceNoGo = true;
    reasons.push("Workflow file modification detected; require human review (default NO_GO).");
    suggestedAdjustments.push("Route workflow changes through manual review/PR approval.");
  }

  const hasDeletionPattern = /(?:^deleted file mode\s+\d+|^---\s+a\/[^\r\n]+\r?\n\+\+\+\s+\/dev\/null|^---\s+\/dev\/null\r?\n\+\+\+\s+b\/[^\r\n]+)/m.test(
    diff
  );
  if (hasDeletionPattern) {
    score += 0.4;
    forceNoGo = true;
    reasons.push("File deletion detected in patch; require human review.");
    suggestedAdjustments.push("Avoid deletions in auto-fix mode or escalate to manual review.");
  }

  const maxFilesWithoutReview = 6;
  if (affectedFiles.length > maxFilesWithoutReview) {
    score += 0.35;
    forceNoGo = true;
    reasons.push(`Patch footprint exceeds cap (${affectedFiles.length} files > ${maxFilesWithoutReview}).`);
    suggestedAdjustments.push("Split into smaller patch sets; keep auto-fix scope narrow.");
  }

  const addedContentLower = getAddedContent(diff).toLowerCase();
  const hasBypassAntiPattern =
    /(?:\bexit\s+0\b|lint:\s*skipped|continue-on-error:\s*true|--no-verify\b|process\.exit\(0\)|\|\|\s*true\b|set\s+\+e\b)/i.test(
      diffLower
    ) ||
    /(?:node_tls_reject_unauthorized\s*=\s*0|git_ssl_no_verify\s*=\s*(?:1|true)|strict-ssl\s*(?:=|\s)\s*false|npm\s+config\s+set\s+strict-ssl\s+false|--insecure\b|\bcurl\b[^\r\n]*\s-k\b)/i.test(
      diffLower
    );

  if (hasBypassAntiPattern) {
    score += 0.55;
    forceNoGo = true;
    reasons.push("Bypass anti-pattern detected (quality gate circumvention signal).");
    suggestedAdjustments.push("Replace bypass logic with real fix for failing step.");
  }

  if (/\b(todo|fixme|hack)\b/.test(addedContentLower)) {
    score += 0.2;
    forceNoGo = true;
    reasons.push("Patch introduces TODO/FIXME/HACK markers.");
    suggestedAdjustments.push("Ship executable fix, not placeholder follow-up markers.");
  }

  if (/(?:@ts-ignore|@ts-nocheck|eslint-disable)/i.test(addedContentLower)) {
    score += 0.35;
    forceNoGo = true;
    reasons.push("TS/lint suppression marker added (@ts-ignore/@ts-nocheck/eslint-disable).");
    suggestedAdjustments.push("Fix underlying TS/lint issue instead of adding suppression.");
  }

  const addedLines = computeAddedLines(diff);
  if (addedLines > 240) {
    score += 0.25;
    reasons.push(`Patch size is large (+${addedLines} lines), raising slop/scope risk.`);
    suggestedAdjustments.push("Split patch into smaller focused changes.");
  }

  if (affectedFiles.length >= 8) {
    score += 0.2;
    reasons.push(`Patch touches ${affectedFiles.length} files (high scope for single failure).`);
    suggestedAdjustments.push("Reduce unrelated file churn.");
  } else if (affectedFiles.length >= 5) {
    score += 0.12;
    reasons.push(`Patch touches ${affectedFiles.length} files (medium scope).`);
    suggestedAdjustments.push("Keep patch focused on root-cause path.");
  }

  const touchesSourceOrTests = affectedFiles.some((file) =>
    /^(src|test|tests)\//.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)
  );
  const touchesLintInfra = affectedFiles.some((file) =>
    file === "package.json" || file.startsWith(".eslintrc") || file === ".eslintignore"
  );
  const touchesBuildInfra = affectedFiles.some((file) =>
    file === "tsconfig.json" || file === "package.json" || file.startsWith(".github/workflows/")
  );

  if (intentKind === "test" && !touchesSourceOrTests) {
    score += 0.3;
    reasons.push("Intent says test fix, but no test/source file is changed.");
    suggestedAdjustments.push("Update failing test files or related source implementation.");
  }
  if (intentKind === "lint" && !(touchesLintInfra || touchesSourceOrTests)) {
    score += 0.25;
    reasons.push("Intent says lint fix, but patch does not touch lint/source targets.");
    suggestedAdjustments.push("Include actual lint remediation in source or lint config.");
  }
  if (intentKind === "build" && !(touchesBuildInfra || touchesSourceOrTests)) {
    score += 0.2;
    reasons.push("Intent says build fix, but patch does not touch build-relevant files.");
    suggestedAdjustments.push("Change build config or affected source modules.");
  }
  if (intentKind === "install" && !affectedFiles.some((f) => f === "package.json" || f === "package-lock.json")) {
    score += 0.2;
    reasons.push("Intent says dependency/install fix, but package manifests are unchanged.");
    suggestedAdjustments.push("Update package manifests/lockfile for dependency failures.");
  }

  const slop_score = clamp01(score);
  const risk_level: "low" | "medium" | "high" =
    slop_score >= 0.7 || forceNoGo ? "high" : slop_score >= 0.35 ? "medium" : "low";
  const verdict: "GO" | "NO_GO" = forceNoGo || slop_score >= 0.65 ? "NO_GO" : "GO";

  return {
    verdict,
    risk_level,
    slop_score,
    reasons,
    suggested_adjustments: suggestedAdjustments
  };
}

function mergeQualityReview(modelReview: QualityReview, deterministicReview: QualityReview): QualityReview {
  const mergedRiskRank = Math.max(RISK_RANK[modelReview.risk_level], RISK_RANK[deterministicReview.risk_level]);
  const risk_level: "low" | "medium" | "high" =
    mergedRiskRank === 2 ? "high" : mergedRiskRank === 1 ? "medium" : "low";

  return {
    verdict: modelReview.verdict === "NO_GO" || deterministicReview.verdict === "NO_GO" ? "NO_GO" : "GO",
    risk_level,
    slop_score: clamp01(Math.max(modelReview.slop_score, deterministicReview.slop_score)),
    reasons: unique([...deterministicReview.reasons, ...modelReview.reasons]),
    suggested_adjustments: unique([
      ...deterministicReview.suggested_adjustments,
      ...modelReview.suggested_adjustments
    ])
  };
}

function normalizeQualityReview(raw: any): QualityReview {
  const verdict: "GO" | "NO_GO" = raw?.verdict === "GO" ? "GO" : "NO_GO";
  const riskLevel: "low" | "medium" | "high" =
    raw?.risk_level === "low" || raw?.risk_level === "medium" || raw?.risk_level === "high"
      ? raw.risk_level
      : "high";
  const reasons = Array.isArray(raw?.reasons) ? raw.reasons.map((x: any) => String(x)) : [];
  const suggestedAdjustments = Array.isArray(raw?.suggested_adjustments)
    ? raw.suggested_adjustments.map((x: any) => String(x))
    : [];
  const numericSlop = Number(raw?.slop_score);
  const slopScore = Number.isFinite(numericSlop) ? numericSlop : 1;

  return {
    verdict,
    reasons,
    risk_level: riskLevel,
    slop_score: slopScore,
    suggested_adjustments: suggestedAdjustments
  };
}

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

async function copilotChat(input: string, context: string, timeout = 150000): Promise<string> {
  return copilotChatAsync(input, {
    spinnerText: `[>] ${context}...`,
    timeout
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const size = Math.max(1, Math.floor(concurrency));
  const out = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(size, items.length) }, () => runWorker());
  await Promise.all(workers);
  return out;
}

export async function generatePatchOptions(
  analysisJson: any,
  outDir = path.join(process.cwd(), ".copilot-guardian"),
  options: PatchGenerationOptions = {}
) {
  const fastMode = Boolean(options.fast);
  const maxPatchRetries = toPositiveInt(options.patchRetries, fastMode ? 2 : 3);
  const patchTimeoutMs = toPositiveInt(options.patchTimeoutMs, fastMode ? 90000 : 180000);
  const qualityTimeoutMs = toPositiveInt(options.qualityTimeoutMs, fastMode ? 70000 : 120000);
  const qualityParallel = toPositiveInt(options.qualityParallel, fastMode ? 3 : 1);
  const skipModelQualityOnDeterministicNoGo =
    typeof options.skipModelQualityOnDeterministicNoGo === "boolean"
      ? options.skipModelQualityOnDeterministicNoGo
      : fastMode;

  console.log(chalk.cyan('\n[>] Generating 3-strategy patch options...'));
  console.log(chalk.dim('    Conservative: Minimal changes, low risk'));
  console.log(chalk.dim('    Balanced: Standard fix, moderate scope'));
  console.log(chalk.dim('    Aggressive: Comprehensive, high risk'));
  if (fastMode) {
    console.log(chalk.dim(`    Fast mode: retries=${maxPatchRetries}, patch_timeout=${patchTimeoutMs}ms, quality_timeout=${qualityTimeoutMs}ms, parallel=${qualityParallel}`));
  }
  ensureDir(outDir);
  
  const prompt = loadText(path.join(PACKAGE_ROOT, "prompts", "patch.options.v1.txt"));

  const baseInput = `${prompt}\n\nANALYSIS_JSON:\n${JSON.stringify(analysisJson, null, 2)}`;
  console.log(chalk.cyan('[>] Asking Copilot for patch strategies...'));

  let raw = "";
  let obj: PatchOptions | null = null;
  let lastParseError: Error | null = null;

  for (let attempt = 1; attempt <= maxPatchRetries; attempt++) {
    const retryNote = attempt === 1
      ? ""
      : `\n\nRETRY ${attempt}/${maxPatchRetries} - STRICT MODE:\n` +
        `Previous response was invalid JSON.\n` +
        `Return ONLY a single JSON object exactly matching the required schema.\n` +
        `No prose. No markdown. No preface. No summary.\n`;
    const attemptInput = baseInput + retryNote;

    raw = await copilotChat(
      attemptInput,
      `Generating 3 patch strategies (attempt ${attempt}/${maxPatchRetries})`,
      patchTimeoutMs
    );
    writeText(path.join(outDir, `copilot.patch.options.raw.attempt${attempt}.txt`), raw);
    writeText(path.join(outDir, "copilot.patch.options.raw.txt"), raw);

    try {
      obj = JSON.parse(extractJsonObject(raw)) as PatchOptions;
      console.log(chalk.green('[+] Received patch strategies from Copilot'));
      break;
    } catch (parseError: any) {
      lastParseError = parseError;
      console.log(chalk.yellow(`[!] Patch generation returned invalid JSON (attempt ${attempt}/${maxPatchRetries})`));
      if (attempt < maxPatchRetries) {
        console.log(chalk.dim('    Retrying with stricter JSON-only instruction...'));
      }
    }
  }

  if (!obj) {
    console.log(chalk.red('[-] Patch generation failed: Invalid JSON from Copilot'));
    throw new Error(`Copilot returned invalid JSON after ${maxPatchRetries} attempts: ${lastParseError?.message || 'unknown parse error'}\n\nSaved to: copilot.patch.options.raw.txt`);
  }
  
  // Validate with fallback
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "patch_options.schema.json"));
    console.log(chalk.green('[+] Patch options validated'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
    console.log(chalk.dim(`    Raw preview: ${raw.slice(0, 240).replace(/\s+/g, ' ')}`));
    
    // Check critical structure
    if (!obj.strategies || !Array.isArray(obj.strategies) || obj.strategies.length === 0) {
      throw new Error('No patch strategies generated. Check copilot.patch.options.raw.txt for details.');
    }
  }

  // Write patch files
  console.log(chalk.cyan('[>] Running quality reviews on each strategy...'));
  const strategies = Array.isArray(obj.strategies) ? obj.strategies : [];
  for (const strat of strategies) {
    const patchPath = path.join(outDir, `fix.${strat.id}.patch`);
    writeText(patchPath, strat.diff.trim() + "\n");
    console.log(chalk.dim(`[>] Saved patch: fix.${strat.id}.patch`));
  }

  const results = await mapWithConcurrency(strategies, qualityParallel, async (strat) => {
    const affectedFiles = extractFilesFromDiff(strat.diff);
    const patchPath = path.join(outDir, `fix.${strat.id}.patch`);
    console.log(chalk.dim(`[>] Quality checking ${strat.id} strategy...`));
    const quality = await qualityReview(analysisJson, strat, affectedFiles, outDir, {
      timeoutMs: qualityTimeoutMs,
      skipModelOnDeterministicNoGo: skipModelQualityOnDeterministicNoGo
    });
    const verdictColor = quality.verdict === "GO" ? chalk.green : chalk.red;
    const slopScore = quality.slop_score !== undefined ? quality.slop_score.toFixed(2) : "0.00";
    console.log(chalk.dim(`    ${strat.label.padEnd(15)}`), verdictColor(quality.verdict), chalk.dim(`slop=${slopScore}`));
    return {
      label: strat.label,
      id: strat.id,
      risk_level: quality.risk_level,
      verdict: quality.verdict,
      slop_score: quality.slop_score,
      patchPath,
      files: affectedFiles,
      summary: strat.summary
    };
  });

  const index = { timestamp: new Date().toISOString(), results };
  writeJson(path.join(outDir, "patch_options.json"), index);
  console.log(chalk.green(`[+] Saved patch index: patch_options.json`));
  
  console.log(chalk.green.bold('\n[+] Patch options complete!'));
  console.log(chalk.dim(`    Total strategies: ${results.length}`));
  console.log(chalk.dim(`    GO verdicts: ${results.filter(r => r.verdict === 'GO').length}`));
  console.log(chalk.dim(`    NO-GO (slop detected): ${results.filter(r => r.verdict === 'NO_GO').length}`));

  return { options: obj, index };
}

async function qualityReview(
  analysisJson: any,
  strat: PatchStrategy,
  affectedFiles: string[],
  outDir: string,
  options: QualityReviewOptions = {}
): Promise<QualityReview> {
  const timeoutMs = toPositiveInt(options.timeoutMs, 120000);
  const skipModelOnDeterministicNoGo = Boolean(options.skipModelOnDeterministicNoGo);
  const deterministic = deterministicQualityReview(analysisJson, strat, affectedFiles);
  const rawPath = path.join(outDir, `copilot.quality.${strat.id}.raw.txt`);
  const reviewPath = path.join(outDir, `quality_review.${strat.id}.json`);

  if (skipModelOnDeterministicNoGo && deterministic.verdict === "NO_GO") {
    const skipped: QualityReview = {
      ...deterministic,
      reasons: unique([
        "Model quality review skipped because deterministic guard already returned NO_GO.",
        ...deterministic.reasons
      ])
    };
    writeText(rawPath, "[SKIPPED] Model quality review was skipped due to deterministic NO_GO.\n");
    writeJson(reviewPath, skipped);
    return skipped;
  }

  const prompt = loadText(path.join(PACKAGE_ROOT, "prompts", "quality.v1.txt"));
  const input = `${prompt}\n\nINPUT:\n${JSON.stringify({
    intent: analysisJson?.patch_plan?.intent,
    allowed_files: analysisJson?.patch_plan?.allowed_files,
    strategy: strat.id,
    diff: strat.diff
  }, null, 2)}`;

  const raw = await copilotChat(input, `Quality review: ${strat.id}`, timeoutMs);
  writeText(rawPath, raw);

  // S2 FIX: Add try-catch for JSON parsing
  let obj: any;
  try {
    obj = JSON.parse(extractJsonObject(raw));
  } catch (parseError: any) {
    console.log(chalk.red(`[-] Quality review failed for ${strat.id}: Invalid JSON`));
    const parseFallback: QualityReview = {
      verdict: "NO_GO",
      slop_score: 1,
      risk_level: "high" as const,
      reasons: [`Parse error: ${parseError.message}`],
      suggested_adjustments: [
        "Re-run quality review with stricter JSON-only response",
        "Inspect copilot.quality.*.raw.txt for malformed output"
      ]
    };
    const merged = mergeQualityReview(parseFallback, deterministic);
    writeJson(reviewPath, merged);
    return merged;
  }
  
  let schemaInvalid = false;
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "quality.schema.json"));
  } catch (error: any) {
    schemaInvalid = true;
    console.log(chalk.yellow(`[!] Quality schema warning for ${strat.id}:`), error.message);
    console.log(chalk.dim(`    Raw preview: ${raw.slice(0, 240).replace(/\s+/g, ' ')}`));
  }

  const normalized = normalizeQualityReview(obj);
  const observedSlop = Number(obj?.slop_score);
  if (Number.isFinite(observedSlop) && observedSlop > 1) {
    console.log(chalk.yellow(`[!] Suspicious slop_score (${observedSlop}) detected for ${strat.id}; possible validation bypass.`));
    normalized.reasons.unshift(`slop_score out of range: ${observedSlop} (expected 0..1)`);
    normalized.suggested_adjustments.unshift("Ensure quality model outputs slop_score in [0,1] and enforce schema hard-fail.");
    normalized.verdict = "NO_GO";
    normalized.risk_level = "high";
    normalized.slop_score = 1;
  }

  if (schemaInvalid) {
    normalized.reasons.unshift("Quality schema validation failed; verdict forced to NO_GO for safety.");
    normalized.verdict = "NO_GO";
    normalized.risk_level = "high";
    normalized.slop_score = Math.max(normalized.slop_score, 1);
  }

  const merged = mergeQualityReview(normalized, deterministic);
  writeJson(reviewPath, merged);
  return merged;
}
