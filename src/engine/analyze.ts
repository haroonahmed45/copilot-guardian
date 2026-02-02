import path from "node:path";
import chalk from "chalk";

import { fetchRunContext, RunContext } from "./github";
import { copilotChatAsync } from "./async-exec";
import { ensureMCPConfigured, enhancePromptWithMCP, saveMCPUsageLog } from "./mcp";
import { enhanceContextWithSources, formatSourceContextForPrompt } from "./context-enhancer";
import {
  ensureDir,
  loadText,
  writeJson,
  writeText,
  extractJsonObject,
  validateJson
} from "./util";

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
  
  // Ensure MCP is configured (auto-setup if needed)
  const mcpEnabled = await ensureMCPConfigured();
  
  console.log(chalk.cyan('[>] Fetching run context from GitHub...'));
  const ctx: RunContext = await fetchRunContext(repo, runId);

  // [PHASE 2] Deep Intelligence: Fetch source files mentioned in errors
  const sourceContexts = await enhanceContextWithSources(ctx.logExcerpt, repo, ctx.headSha);
  const sourceContextPrompt = formatSourceContextForPrompt(sourceContexts);

  const promptPath = path.join(process.cwd(), "prompts", "analysis.v2.txt");
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

  const fullInput = `${prompt}\n\nINPUT:\n${JSON.stringify(inputContext, null, 2)}${sourceContextPrompt}`;
  
  // Save the MCP-enhanced prompt for judges to see
  writeText(path.join(outDir, "copilot.analysis.prompt.txt"), fullInput);
  console.log(chalk.dim('[>] Prompt saved (with MCP instructions)'));
  
  const raw = await copilotChat(fullInput);
  writeText(path.join(outDir, "copilot.analysis.raw.txt"), raw);
  
  // Log MCP usage if response mentions it
  if (mcpEnabled && (raw.includes('@github') || raw.includes('MCP'))) {
    saveMCPUsageLog(
      'multi-hypothesis-analysis',
      [`@github/runs/${runId}`, `@github/jobs`, `@github/repository/${repo}`],
      outDir
    );
  }
  
  console.log(chalk.dim('[>] Raw response saved'));

  const obj = JSON.parse(extractJsonObject(raw));
  
  // Validate
  try {
    validateJson(obj, path.join(process.cwd(), "schemas", "analysis.schema.json"));
    console.log(chalk.green('[+] Response validated against schema'));
  } catch (error: any) {
    console.log(chalk.yellow('[!] Schema validation warning:'), error.message);
  }

  const analysisPath = path.join(outDir, "analysis.json");
  writeJson(analysisPath, obj);

  // Reasoning trace: save hypotheses + selected.
  const reasoningTrace = {
    timestamp: new Date().toISOString(),
    mcp_used: mcpEnabled,
    hypotheses: obj.diagnosis?.hypotheses,
    selected: obj.diagnosis?.selected_hypothesis_id
  };
  writeJson(path.join(outDir, "reasoning_trace.json"), reasoningTrace);
  
  console.log(chalk.green('[+] Analysis complete'));
  console.log(chalk.dim(`  Hypotheses: ${obj.diagnosis?.hypotheses?.length || 0}`));
  console.log(chalk.dim(`  Selected: ${obj.diagnosis?.selected_hypothesis_id}`));
  if (mcpEnabled) {
    console.log(chalk.dim(`  MCP: Used @github server`));
  }

  return { analysisPath, analysis: obj as AnalysisJson, ctx };
}
