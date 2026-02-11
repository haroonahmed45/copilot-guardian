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
  maxLogChars?: number;
  fast?: boolean;
};

type AbstainDecision = {
  abstain: boolean;
  classification: "NOT_PATCHABLE" | "PATCHABLE";
  reason: string;
  signals: string[];
};

function detectForcedAbstain(ctx: any): AbstainDecision {
  const step = String(ctx?.step || "");
  const summary = String(ctx?.logSummary || "");
  const excerptTail = String(ctx?.logExcerpt || "").slice(-6000);
  const haystack = `${step}\n${summary}\n${excerptTail}`.toLowerCase();
  const strongSignals: string[] = [];
  const weakSignals: string[] = [];

  const checks: Array<{ label: string; pattern: RegExp; strength: "strong" | "weak" }> = [
    { label: "auth_401_403", strength: "strong", pattern: /\b(401|403)\b|unauthorized|forbidden|bad credentials|authentication failed/ },
    { label: "github_token_permission", strength: "strong", pattern: /resource not accessible by integration|insufficient permissions|github_token permission|token does not have permission/ },
    { label: "rate_limit", strength: "strong", pattern: /rate limit exceeded|api rate limit|secondary rate limit/ },
    { label: "runner_unavailable", strength: "weak", pattern: /runner offline|no runners? available|waiting for a runner to pick up this job/ },
    { label: "service_unavailable", strength: "weak", pattern: /service unavailable|502 bad gateway|503 service unavailable|temporarily unavailable/ },
    { label: "permission_denied_generic", strength: "weak", pattern: /\bpermission denied\b/ }
  ];

  for (const check of checks) {
    if (!check.pattern.test(haystack)) continue;
    if (check.strength === "strong") strongSignals.push(check.label);
    else weakSignals.push(check.label);
  }

  const shouldAbstain = strongSignals.length >= 1 || weakSignals.length >= 2;
  const signals = [...strongSignals, ...weakSignals];

  if (shouldAbstain) {
    return {
      abstain: true,
      classification: "NOT_PATCHABLE",
      reason: "Failure appears to be auth/permission/infra related; forcing abstain for safety.",
      signals
    };
  }

  return {
    abstain: false,
    classification: "PATCHABLE",
    reason: "",
    signals: []
  };
}

export async function runGuardian(repo: string, runId: number, flags: RunFlags) {
  const outDir = flags.outDir || path.join(process.cwd(), ".copilot-guardian");
  ensureDir(outDir);
  
  console.log(chalk.bold.cyan('\n=== Copilot Guardian Analysis ===\n'));
  console.log(chalk.dim(`Repository: ${repo}`));
  console.log(chalk.dim(`Run ID: ${runId}`));
  console.log(chalk.dim(`Output: ${outDir}\n`));

  const { analysisPath, analysis, ctx } = await analyzeRun(
    repo,
    runId,
    outDir,
    flags.maxLogChars,
    {
      fast: Boolean(flags.fast)
    }
  );

  // Default: generate options only if requested (for speed)
  let patchIndex: any | undefined;
  if (flags.showOptions) {
    const abstainDecision = detectForcedAbstain(ctx);
    if (abstainDecision.abstain) {
      const abstainReport = {
        timestamp: new Date().toISOString(),
        repo,
        run_id: runId,
        classification: abstainDecision.classification,
        reason: abstainDecision.reason,
        signals: abstainDecision.signals,
        recommended_actions: [
          "Escalate to human operator for auth/permissions/infra remediation.",
          "Do not auto-apply patches for this failure class.",
          "Re-run Guardian after infrastructure/auth issue is resolved."
        ]
      };
      writeJson(path.join(outDir, "abstain.report.json"), abstainReport);
      patchIndex = { timestamp: new Date().toISOString(), results: [], abstain: abstainReport };
      console.log(chalk.yellow('\n[!] Forced ABSTAIN triggered.'));
      console.log(chalk.dim(`    Classification: ${abstainReport.classification}`));
      console.log(chalk.dim(`    Signals: ${abstainReport.signals.join(", ")}`));
      console.log(chalk.dim(`    Saved: ${path.join(outDir, "abstain.report.json")}\n`));
    } else {
      const { index } = await generatePatchOptions(analysis, outDir, {
        fast: Boolean(flags.fast)
      });
      patchIndex = index;
      const allNoGo = index?.results?.length > 0 && index.results.every((r: any) => r.verdict === "NO_GO");
      if (allNoGo) {
        const currentMax = Number.isFinite(flags.maxLogChars) ? Number(flags.maxLogChars) : 12000;
        const suggestedMax = Math.min(currentMax * 3, 120000);
        console.log(chalk.yellow('\n[!] All strategies are NO_GO.'));
        console.log(chalk.dim(`    Suggestion: re-run diagnosis with wider logs (--max-log-chars ${suggestedMax}).`));
        console.log(chalk.dim(`    Example: copilot-guardian run --repo ${repo} --run-id ${runId} --show-options --max-log-chars ${suggestedMax}\n`));
      }
    }
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
    if (patchIndex?.abstain) {
      console.log(chalk.dim('  - abstain.report.json (forced abstain classification)'));
    } else {
      console.log(chalk.dim('  - fix.*.patch (3 patch strategies)'));
      console.log(chalk.dim('  - patch_options.json (quality review results)'));
    }
  }
  console.log("");

  return { analysis, patchIndex, outDir, ctx };
}
