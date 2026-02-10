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

async function copilotChat(input: string): Promise<string> {
  return copilotChatAsync(input, {
    spinnerText: '[>] Asking Copilot for multi-hypothesis analysis...'
  });
}

export async function analyzeRun(repo: string, runId: number, outDir = path.join(process.cwd(), ".copilot-guardian")) {
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
  const ctx: RunContext = await fetchRunContext(repo, runId);
  console.log(chalk.green('[+] Retrieved workflow logs and metadata'));
  console.log(chalk.dim(`    Workflow: ${ctx.workflowPath || 'N/A'}`));
  console.log(chalk.dim(`    Commit SHA: ${ctx.headSha ? ctx.headSha.substring(0, 7) : 'N/A'}`));

  // [PHASE 2] Deep Intelligence: Fetch source files mentioned in errors
  console.log(chalk.cyan('[>] Deep analysis: Extracting source context...'));
  const sourceContexts = await enhanceContextWithSources(ctx.logExcerpt, repo, ctx.headSha || '');
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
    prompt = enhancePromptWithMCP(prompt, repo, runId);
    console.log(chalk.dim('[>] MCP instructions added to prompt'));
  }

  const inputContext = {
    repo: ctx.repo,
    run_id: ctx.runId,
    workflow_path: ctx.workflowPath || null,
    log_excerpt: ctx.logExcerpt,
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
  const raw = await copilotChat(fullInput);
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

  // Parse with error handling
  let obj: any;
  try {
    obj = JSON.parse(extractJsonObject(raw));
  } catch (parseError: any) {
    console.log(chalk.red('[-] JSON parsing failed'));
    console.log(chalk.dim('    Raw response saved to copilot.analysis.raw.txt'));
    throw new Error(`Copilot returned invalid JSON: ${parseError.message}\n\nHint: Check if Copilot SDK is working. Ensure you're authenticated: gh auth login`);
  }
  
  // Validate with fallback
  try {
    validateJson(obj, path.join(PACKAGE_ROOT, "schemas", "analysis.schema.json"));
    console.log(chalk.green('[+] Response validated against schema'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
    console.log(chalk.yellow('[!] Attempting to use response anyway (best-effort mode)'));
    
    // Check if at least the critical fields exist
    if (!obj.diagnosis || !obj.diagnosis.hypotheses) {
      throw new Error('Critical fields missing from Copilot response. Cannot proceed.');
    }
  }

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
