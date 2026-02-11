import path from "node:path";
import chalk from "chalk";

import { fetchRunContext, RunContext } from "./github.js";
import { copilotChatAsync } from "./async-exec.js";
import { ensureMCPConfigured, enhancePromptWithMCP, saveMCPUsageLog } from "./mcp.js";
import { enhanceContextWithSources, formatSourceContextForPrompt } from "./context-enhancer.js";
import {
  ensureDir,
  loadText,
  writeJson,
  writeText,
  extractJsonObject,
  validateJson,
  PACKAGE_ROOT
} from "./util.js";

export interface Hypothesis {
  id: string;
  title: string;
  category: string;
  confidence: number;
  evidence: string[];
  disconfirming: string[];
  next_check: string;
}

export type AnalysisJson = {
  metadata: {
    repo: string;
    run_id: number;
    workflow_path?: string;
    redacted: boolean;
  };
  failure_context: {
    job: string;
    step: string;
    exit_code: number;
    log_summary: string;
  };
  diagnosis: {
    hypotheses: Hypothesis[];
    selected_hypothesis_id: string;
    category: string;
    root_cause: string;
    evidence: string[];
    confidence_score: number;
  };
  patch_plan: {
    intent: string;
    allowed_files: string[];
    strategy: string;
  };
};

function normalizeStep(step?: string): string {
  return (step || "").toLowerCase();
}

function getStepCategoryBoost(step?: string): Record<string, number> {
  const s = normalizeStep(step);
  const base: Record<string, number> = {};

  if (s.includes("test")) {
    base.source_code = 0.18;
    base.dependency = 0.08;
    base.environment = 0.02;
    base.network = -0.04;
  } else if (s.includes("lint")) {
    base.source_code = 0.14;
    base.dependency = 0.1;
    base.environment = 0.02;
    base.network = -0.03;
  } else if (s.includes("build") || s.includes("compile")) {
    base.source_code = 0.12;
    base.dependency = 0.08;
    base.environment = 0.04;
  } else if (s.includes("install") || s.includes("npm ci")) {
    base.dependency = 0.18;
    base.network = 0.08;
    base.permissions = 0.04;
    base.source_code = -0.06;
  }

  return base;
}

function dedupe(values: string[]): string[] {
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

function computeDynamicAllowedFiles(
  ctx: RunContext,
  selectedCategory?: string,
  modelAllowedFiles: string[] = []
): string[] {
  const step = normalizeStep(ctx.step);
  const category = (selectedCategory || "").toLowerCase();

  const defaults = ["src/**/*.ts", "src/**/*.js"];
  const dynamic: string[] = [...defaults];

  if (step.includes("test")) {
    dynamic.push(
      "tests/**/*.ts",
      "tests/**/*.js",
      "**/*.test.ts",
      "**/*.test.js",
      "**/*.spec.ts",
      "**/*.spec.js",
      "jest.config.*",
      "tsconfig.json",
      "package.json"
    );
  }

  if (step.includes("lint")) {
    dynamic.push(
      ".eslintrc.*",
      ".eslintignore",
      "src/**/*.ts",
      "src/**/*.js",
      "package.json"
    );
  }

  if (step.includes("build") || step.includes("compile")) {
    dynamic.push("tsconfig.json", "package.json", "src/**/*.ts", "src/**/*.js");
  }

  if (step.includes("install") || step.includes("npm ci")) {
    dynamic.push("package.json", "package-lock.json");
  }

  if (category === "workflow_yaml" || category === "permissions" || category === "network") {
    dynamic.push(".github/workflows/*.yml", ".github/workflows/*.yaml");
  }

  if (category === "dependency") {
    dynamic.push("package.json", "package-lock.json");
  }

  if (ctx.workflowPath) {
    dynamic.push(ctx.workflowPath);
  }

  if (Array.isArray(ctx.failedTestFiles)) {
    dynamic.push(...ctx.failedTestFiles);
  }

  return dedupe([...modelAllowedFiles, ...dynamic]);
}

function inferStepAwareIntent(step?: string): string | undefined {
  const s = normalizeStep(step);
  if (!s) return undefined;
  if (s.includes("test")) return "Fix failing tests and underlying code issues in test/source paths to pass npm test.";
  if (s.includes("lint")) return "Fix lint failures by applying minimal ESLint-compatible source/config updates.";
  if (s.includes("build") || s.includes("compile")) return "Fix build/compile failures with minimal source/config changes to restore build stability.";
  if (s.includes("install") || s.includes("npm ci")) return "Fix dependency/install failures by correcting package manager configuration and lockfiles.";
  return undefined;
}

function intentMismatchedWithStep(intent: string, step?: string): boolean {
  const s = normalizeStep(step);
  const i = (intent || "").toLowerCase();
  if (!s || !i) return false;

  if (s.includes("test") && i.includes("lint")) return true;
  if (s.includes("lint") && i.includes("test")) return true;
  if (s.includes("build") && (i.includes("lint") || i.includes("test"))) return false;
  return false;
}

function applyStepAwareAdjustments(obj: any, ctx: RunContext): void {
  const hypotheses: Hypothesis[] = Array.isArray(obj?.diagnosis?.hypotheses) ? obj.diagnosis.hypotheses : [];
  if (hypotheses.length === 0) return;

  const boosts = getStepCategoryBoost(ctx.step);
  const scored = hypotheses.map((h) => {
    const base = Number.isFinite(h.confidence) ? h.confidence : 0;
    const boost = boosts[(h.category || "").toLowerCase()] || 0;
    return { hypothesis: h, score: Math.max(0, base + boost) };
  });

  const sum = scored.reduce((acc, item) => acc + item.score, 0);
  if (sum > 0) {
    for (const item of scored) {
      item.hypothesis.confidence = Number((item.score / sum).toFixed(4));
    }
  }

  scored.sort((a, b) => b.hypothesis.confidence - a.hypothesis.confidence);
  const selected = scored[0]?.hypothesis;
  if (selected?.id) {
    const previous = obj?.diagnosis?.selected_hypothesis_id;
    obj.diagnosis.selected_hypothesis_id = selected.id;
    obj.diagnosis.category = selected.category;
    if (previous && previous !== selected.id) {
      obj.diagnosis.selection_note = `Step-aware weighting switched selection from ${previous} to ${selected.id} (failed step: ${ctx.step || "unknown"}).`;
    }
  }

  const currentAllowed = Array.isArray(obj?.patch_plan?.allowed_files) ? obj.patch_plan.allowed_files : [];
  const dynamicAllowed = computeDynamicAllowedFiles(ctx, obj?.diagnosis?.category, currentAllowed);
  if (!obj.patch_plan || typeof obj.patch_plan !== "object") obj.patch_plan = {};
  obj.patch_plan.allowed_files = dynamicAllowed;
  obj.patch_plan.allowlist_source = "step-aware-dynamic-mapping";

  const existingIntent = typeof obj.patch_plan.intent === "string" ? obj.patch_plan.intent : "";
  const stepIntent = inferStepAwareIntent(ctx.step);
  if (stepIntent && (!existingIntent || intentMismatchedWithStep(existingIntent, ctx.step))) {
    obj.patch_plan.intent = stepIntent;
    obj.patch_plan.intent_source = "step-aware-intent";
  }
}

async function copilotChat(input: string, timeout = 120000): Promise<string> {
  return copilotChatAsync(input, {
    spinnerText: '[>] Asking Copilot for multi-hypothesis analysis...',
    timeout
  });
}

export async function analyzeRun(
  repo: string,
  runId: number,
  outDir = path.join(process.cwd(), ".copilot-guardian"),
  maxLogChars = 12000,
  options: {
    fast?: boolean;
    maxSourceFiles?: number;
    analysisTimeoutMs?: number;
  } = {}
) {
  const fastMode = Boolean(options.fast);
  const maxSourceFiles =
    Number.isFinite(options.maxSourceFiles) && Number(options.maxSourceFiles) > 0
      ? Number(options.maxSourceFiles)
      : fastMode
        ? 3
        : 8;
  const analysisTimeoutMs =
    Number.isFinite(options.analysisTimeoutMs) && Number(options.analysisTimeoutMs) > 0
      ? Number(options.analysisTimeoutMs)
      : fastMode
        ? 90000
        : 120000;

  console.log(chalk.cyan('[>] Starting analysis...'));
  ensureDir(outDir);
  console.log(chalk.dim(`    Output directory: ${outDir}`));
  
  // Ensure MCP is configured (auto-setup if needed)
  console.log(chalk.cyan('[>] Checking GitHub MCP configuration...'));
  const mcpEnabled = await ensureMCPConfigured();
  if (mcpEnabled) {
    console.log(chalk.green('[+] GitHub MCP server ready'));
  }
  
  console.log(chalk.cyan('[>] Fetching run context from GitHub...'));
  const ctx: RunContext = await fetchRunContext(repo, runId, maxLogChars);
  console.log(chalk.green('[+] Retrieved workflow logs and metadata'));
  console.log(chalk.dim(`    Workflow: ${ctx.workflowPath || 'N/A'}`));
  console.log(chalk.dim(`    Commit SHA: ${ctx.headSha ? ctx.headSha.substring(0, 7) : 'N/A'}`));
  if (ctx.step) {
    console.log(chalk.dim(`    Failed step: ${ctx.step}`));
  }
  if (ctx.job) {
    console.log(chalk.dim(`    Failed job: ${ctx.job}`));
  }

  // [PHASE 2] Deep Intelligence: Fetch source files mentioned in errors
  console.log(chalk.cyan('[>] Deep analysis: Extracting source context...'));
  const sourceContexts = await enhanceContextWithSources(
    ctx.logExcerpt,
    repo,
    ctx.headSha || '',
    ctx.failedTestFiles || [],
    maxSourceFiles
  );
  if (sourceContexts.length > 0) {
    console.log(chalk.green(`[+] Found ${sourceContexts.length} source file(s) mentioned in errors`));
    sourceContexts.forEach(src => {
      console.log(chalk.dim(`    - ${src.file}:${src.lineStart}-${src.lineEnd}`));
    });
  } else {
    console.log(chalk.dim('[~] No specific source files extracted from logs'));
  }
  const sourceContextPrompt = formatSourceContextForPrompt(sourceContexts);

  const promptPath = path.join(PACKAGE_ROOT, "prompts", "analysis.v2.txt");
  let prompt = loadText(promptPath);
  
  // Enhance prompt with MCP instructions if available
  if (mcpEnabled) {
    prompt = enhancePromptWithMCP(prompt, repo, runId, {
      failedStep: ctx.step,
      failedTestFiles: ctx.failedTestFiles,
      assertionSignals: ctx.assertionSignals
    });
    console.log(chalk.dim('[>] MCP instructions added to prompt'));
  }

  const inputContext = {
    repo: ctx.repo,
    run_id: ctx.runId,
    workflow_path: ctx.workflowPath || null,
    failed_job: ctx.job || null,
    failed_step: ctx.step || null,
    failed_exit_code: ctx.exitCode ?? null,
    log_excerpt: ctx.logExcerpt,
    log_max_chars: maxLogChars,
    failed_test_files: ctx.failedTestFiles || [],
    assertion_signals: ctx.assertionSignals || [],
    workflow_yaml: ctx.workflowYaml || null,
    source_files: sourceContexts.map(s => ({ file: s.file, lines: `${s.lineStart}-${s.lineEnd}` }))
  };

  const inputPath = path.join(outDir, "input.context.json");
  writeJson(inputPath, inputContext);
  console.log(chalk.dim(`[>] Saved input context: ${path.basename(inputPath)}`));

  const fullInput = `${prompt}\n\nINPUT:\n${JSON.stringify(inputContext, null, 2)}${sourceContextPrompt}`;
  
  // Save the MCP-enhanced prompt for judges to see
  writeText(path.join(outDir, "copilot.analysis.prompt.txt"), fullInput);
  console.log(chalk.dim(`[>] Saved prompt: copilot.analysis.prompt.txt`));
  
  console.log(chalk.cyan('[>] Sending to Copilot for multi-hypothesis analysis...'));
  console.log(chalk.dim('    (This may take 30-60 seconds)'));
  const raw = await copilotChat(fullInput, analysisTimeoutMs);
  writeText(path.join(outDir, "copilot.analysis.raw.txt"), raw);
  console.log(chalk.green('[+] Received response from Copilot'));
  console.log(chalk.dim(`[>] Saved raw response: copilot.analysis.raw.txt`));
  
  // Log MCP usage if response mentions it
  if (mcpEnabled && (raw.includes('@github') || raw.includes('MCP'))) {
    saveMCPUsageLog(
      'multi-hypothesis-analysis',
      [`@github/runs/${runId}`, `@github/jobs`, `@github/repository/${repo}`],
      outDir
    );
  }
  
  console.log(chalk.dim('[>] Raw response saved'));

  // Parse with enhanced error handling
  let obj: any;
  try {
    const jsonStr = extractJsonObject(raw);
    obj = JSON.parse(jsonStr);
    console.log(chalk.green('[+] Successfully parsed JSON response'));
  } catch (parseError: any) {
    console.log(chalk.red('[-] JSON parsing failed'));
    console.log(chalk.yellow(`    Error: ${parseError.message}`));
    console.log(chalk.dim('    Raw response saved to copilot.analysis.raw.txt'));
    console.log(chalk.dim('    First 300 chars of response:'));
    console.log(chalk.dim(`    ${raw.substring(0, 300).replace(/\n/g, ' ')}...`));
    throw new Error(`Copilot returned invalid JSON: ${parseError.message}\n\nHint: Check copilot.analysis.raw.txt for full response. Copilot may have returned prose/markdown instead of JSON.`);
  }
  
  // Validate with fallback
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "analysis.schema.json"));
    console.log(chalk.green('[+] Response validated against schema'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
    console.log(chalk.dim(`    Raw preview: ${raw.slice(0, 240).replace(/\s+/g, ' ')}`));
    console.log(chalk.yellow('[!] Attempting to use response anyway (best-effort mode)'));
    
    // Check if at least the critical fields exist
    if (!obj.diagnosis || !obj.diagnosis.hypotheses) {
      throw new Error('Critical fields missing from Copilot response. Cannot proceed.');
    }
  }

  // Step-aware post-processing: weighted hypothesis selection + dynamic allowlist
  applyStepAwareAdjustments(obj, ctx);

  const analysisPath = path.join(outDir, "analysis.json");
  writeJson(analysisPath, obj);
  console.log(chalk.green(`[+] Saved analysis: ${path.basename(analysisPath)}`));

  // Reasoning trace: save hypotheses + selected.
  const reasoningTrace = {
    timestamp: new Date().toISOString(),
    mcp_used: mcpEnabled,
    hypotheses: obj.diagnosis?.hypotheses,
    selected: obj.diagnosis?.selected_hypothesis_id
  };
  writeJson(path.join(outDir, "reasoning_trace.json"), reasoningTrace);
  console.log(chalk.green(`[+] Saved reasoning trace: reasoning_trace.json`));
  
  console.log(chalk.green.bold('\n[+] Analysis complete!'));
  console.log(chalk.dim(`    Hypotheses generated: ${obj.diagnosis?.hypotheses?.length || 0}`));
  console.log(chalk.dim(`    Selected hypothesis: ${obj.diagnosis?.selected_hypothesis_id}`));
  console.log(chalk.dim(`    Root cause: ${obj.diagnosis?.root_cause?.substring(0, 60)}...`));
  if (mcpEnabled) {
    console.log(chalk.dim(`    MCP integration: Active (@github server)`));
  }

  return { analysisPath, analysis: obj as AnalysisJson, ctx };
}
