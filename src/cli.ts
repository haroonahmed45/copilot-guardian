#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";

import { getLastFailedRunId } from "./engine/github.js";
import { runGuardian } from "./engine/run.js";
import { analyzeRun } from "./engine/analyze.js";
import { debugInteractive } from "./engine/debug.js";
import { runEvaluationHarness, getRecentFailedRunIds, parseRunIds, parseRunIdsFile } from "./engine/eval.js";
import { renderHypotheses, renderPatchSpectrum, renderHeader, renderSummary } from "./ui/dashboard.js";
import { checkGHCLI, checkCopilotCLI, closeSdkClient } from "./engine/async-exec.js";

// SDK-2: Graceful shutdown - cleanup SDK client on exit
async function cleanup() {
  await closeSdkClient();
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

process.on('exit', () => {
  // Note: async operations may not complete in 'exit' handler
  // The SIGINT/SIGTERM handlers above handle graceful shutdown
});

function riskRank(level: string): number {
  if (level === "low") return 0;
  if (level === "medium") return 1;
  return 2;
}

function chooseBestGoPatch(results: any[]): any | undefined {
  const go = (results || []).filter((r: any) => r?.verdict === "GO");
  if (go.length === 0) return undefined;

  go.sort((a: any, b: any) => {
    const riskDelta = riskRank(String(a?.risk_level)) - riskRank(String(b?.risk_level));
    if (riskDelta !== 0) return riskDelta;
    const slopA = Number.isFinite(Number(a?.slop_score)) ? Number(a.slop_score) : 1;
    const slopB = Number.isFinite(Number(b?.slop_score)) ? Number(b.slop_score) : 1;
    if (slopA !== slopB) return slopA - slopB;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  });

  return go[0];
}

const program = new Command();

program
  .name("copilot-guardian")
  .description(chalk.cyan("[#] Sovereign AI Guardian for GitHub Actions"))
  .version("0.2.5");

program
  .command("auth")
  .description("[#] Check GitHub CLI and Copilot permissions")
  .action(async () => {
    console.log(chalk.bold("\n--- Guardian Auth Diagnostics ---\n"));
    
    const hasGH = await checkGHCLI();
    if (hasGH) {
      console.log(chalk.green("[+] GitHub CLI: Authenticated"));
    } else {
      console.log(chalk.red("[-] GitHub CLI: Not found or not authenticated"));
      console.log(chalk.dim("    Install: https://cli.github.com"));
      console.log(chalk.dim("    Authenticate: gh auth login"));
      process.exit(1);
    }
    
    const hasCopilot = await checkCopilotCLI();
    if (hasCopilot) {
      console.log(chalk.green("[+] GitHub Copilot SDK: Available"));
    } else {
      console.log(chalk.red("[-] GitHub Copilot SDK: Not available"));
      console.log(chalk.dim("    Install: npm install @github/copilot-sdk"));
      process.exit(1);
    }
    
    console.log(chalk.green("\n[+] All systems ready\n"));
  });

program
  .command("run")
  .description("[>] One-shot: Analyze failure + (optional) patch spectrum")
  .requiredOption("-r, --repo <owner/repo>", "Target repository")
  .option("-i, --run-id <id>", "Specific run ID")
  .option("--last-failed", "Auto-select the most recent failed run")
  .option("--show-reasoning", "Render multi-hypothesis dashboard")
  .option("--show-options", "Generate 3 patch strategies + quality verdicts")
  .option("--strategy <conservative|balanced|aggressive>", "Preferred patch strategy", "conservative")
  .option("--auto-heal", "[W] Self-healing mode: auto-apply + commit + push + CI retry loop")
  .option("--allow-direct-push", "[!] Allow direct push in auto-heal (unsafe; default is PR-only safe mode)")
  .option("--base-branch <name>", "Base branch for auto-heal PR (default: current branch)")
  .option("--max-retries <n>", "Maximum CI retry attempts in auto-heal mode", "3")
  .option("--max-log-chars <n>", "Maximum failed-log characters to analyze", "12000")
  .option("--fast", "Fast mode: shorter timeouts, fewer source fetches, parallel quality checks")
  .option("--out-dir <path>", "Output directory for artifacts", ".copilot-guardian")
  .action(async (opts) => {
    try {
      const repo = opts.repo as string;
      let runId: number;
      
      if (opts.lastFailed) {
        runId = await getLastFailedRunId(repo);
      } else if (opts.runId) {
        runId = Number(opts.runId);
      } else {
        throw new Error("Provide --run-id or --last-failed");
      }

      const maxLogChars = Number(opts.maxLogChars);
      if (!Number.isFinite(maxLogChars) || maxLogChars < 2000) {
        throw new Error("--max-log-chars must be a number >= 2000");
      }
      const maxRetries = Number(opts.maxRetries);
      if (!Number.isFinite(maxRetries) || maxRetries < 1 || maxRetries > 10) {
        throw new Error("--max-retries must be a number between 1 and 10");
      }

      renderHeader(repo, runId);
      const res = await runGuardian(repo, runId, {
        showReasoning: Boolean(opts.showReasoning),
        showOptions: Boolean(opts.showOptions),
        strategy: opts.strategy,
        outDir: opts.outDir,
        maxLogChars,
        fast: Boolean(opts.fast)
      });

      renderSummary(res.analysis);

      if (opts.showReasoning) {
        renderHypotheses(res.analysis.diagnosis.hypotheses);
      }

      if (opts.showOptions && res.patchIndex) {
        renderPatchSpectrum(res.patchIndex);
        
        // Auto-heal mode: apply best patch and retry CI
        if (opts.autoHeal) {
          console.log(chalk.yellow.bold('\n[!] AUTO-HEAL MODE ACTIVATED\n'));
          console.log(chalk.gray('    "Sleep while Guardian fixes it" - The Sovereign Promise\n'));
          
          // Select best patch (GO verdict + lowest risk + lowest slop)
          const bestPatch = chooseBestGoPatch(res.patchIndex.results);
          if (!bestPatch) {
            console.log(chalk.red('[-] No safe patch found (all NO-GO). Manual intervention required.\n'));
            process.exit(1);
          }
          
          console.log(chalk.cyan(`[>] Selected: ${bestPatch.label} (risk: ${bestPatch.risk_level})`));
          
          // Apply patch using git apply (safe method)
          try {
            const { applyPatchViaDiff, ensureAutoHealBranch, rerunLatestRunForCommit, waitForCIFinalStatus } = await import('./engine/auto-apply.js');
            const { execAsync } = await import('./engine/async-exec.js');
            
            // Read patch content
            const fs = await import('fs/promises');
            const diffContent = await fs.readFile(bestPatch.patchPath, 'utf-8');
            
            const allowedFilesRaw = res.analysis?.patch_plan?.allowed_files ?? [];
            const allowedFiles = allowedFilesRaw.filter((f: any) => typeof f === "string" && f.trim().length > 0);

            if (allowedFiles.length === 0) {
              throw new Error("Allowlist is empty; refusing to apply patch.");
            }

            const branchCtx = await ensureAutoHealBranch(runId, {
              directPush: Boolean(opts.allowDirectPush),
              baseBranch: opts.baseBranch ? String(opts.baseBranch) : undefined
            });
            if (branchCtx.createdSafeBranch) {
              console.log(chalk.green(`[+] Safe branch created: ${branchCtx.pushBranch}`));
              console.log(chalk.dim(`    Base branch: ${branchCtx.baseBranch}`));
            } else {
              console.log(chalk.yellow('[!] Direct push mode enabled (unsafe).'));
            }

            let commitCreated = false;
            let commitSha = '';
            try {
              // Apply with safety checks
              const modifiedFiles = await applyPatchViaDiff(diffContent, false, {
                allowedFiles,
                repoRoot: process.cwd()
              });

              // Commit changes
              await execAsync('git', ['add', ...modifiedFiles]);

              const commitMsg = `fix: Guardian auto-heal (${bestPatch.label})`;
              await execAsync('git', ['commit', '-m', commitMsg]);
              commitCreated = true;

              commitSha = (await execAsync('git', ['rev-parse', 'HEAD'])).trim();
              console.log(chalk.green(`[+] Patch applied & committed: ${commitSha.substring(0, 7)}`));
            } catch (patchError: any) {
              if (branchCtx.createdSafeBranch && !commitCreated) {
                try {
                  await execAsync('git', ['checkout', branchCtx.currentBranch]);
                  await execAsync('git', ['branch', '-D', branchCtx.pushBranch]);
                  console.log(chalk.dim(`[~] Cleaned up safe branch after failed apply: ${branchCtx.pushBranch}`));
                } catch {}
              }
              throw patchError;
            }

            if (branchCtx.directPush) {
              await execAsync('git', ['push', 'origin', 'HEAD']);
              console.log(chalk.green('[+] Pushed to remote (direct push mode)'));
            } else {
              await execAsync('git', ['push', '-u', 'origin', branchCtx.pushBranch]);
              console.log(chalk.green(`[+] Pushed safe branch: ${branchCtx.pushBranch}`));
              try {
                const prTitle = `fix: Guardian auto-heal run ${runId} (${bestPatch.label})`;
                const prBody = [
                  'Automated safe-mode patch from Copilot Guardian.',
                  '',
                  `- Run ID: ${runId}`,
                  `- Strategy: ${bestPatch.label}`,
                  `- Risk: ${bestPatch.risk_level}`,
                  `- Slop: ${bestPatch.slop_score}`,
                  '',
                  'Safety: PR-only mode (default). No direct push to default branch.'
                ].join('\n');
                await execAsync('gh', [
                  'pr', 'create',
                  '--repo', repo,
                  '--head', branchCtx.pushBranch,
                  '--base', branchCtx.baseBranch,
                  '--title', prTitle,
                  '--body', prBody
                ]);
                console.log(chalk.green(`[+] Pull request created: ${branchCtx.pushBranch} -> ${branchCtx.baseBranch}`));
              } catch (prError: any) {
                console.log(chalk.yellow(`[!] Could not create PR automatically: ${prError.message}`));
                console.log(chalk.dim(`    Create manually: gh pr create --repo ${repo} --head ${branchCtx.pushBranch} --base ${branchCtx.baseBranch}`));
              }
            }

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              console.log(chalk.yellow(`[~] CI verification attempt ${attempt}/${maxRetries}...`));
              const ciStatus = await waitForCIFinalStatus(commitSha, {
                pollIntervalMs: 15000,
                maxPolls: 8
              });

              if (ciStatus === 'passed') {
                console.log(chalk.green.bold('\n[W] VICTORY! Guardian healed the CI!\n'));
                console.log(chalk.cyan('    Sleep well. CI is green.\n'));
                process.exit(0);
              }

              if (ciStatus === 'failed' && attempt < maxRetries) {
                const rerunId = await rerunLatestRunForCommit(repo, commitSha);
                if (rerunId) {
                  console.log(chalk.yellow(`[~] CI failed; triggered rerun for workflow run ${rerunId}.`));
                  continue;
                }
                console.log(chalk.yellow('[~] CI failed and auto-rerun could not be triggered. Stopping retries.'));
                break;
              }

              if (ciStatus === 'pending') {
                console.log(chalk.yellow('[~] CI status still pending after polling window.'));
              } else {
                console.log(chalk.yellow('[~] CI failed after retry budget.'));
              }
              break;
            }

            process.exit(1);
            
          } catch (error: any) {
            console.log(chalk.red(`\n[-] Auto-heal failed: ${error.message}\n`));
            process.exit(1);
          }
          
        } else {
          console.log(
            chalk.dim(`\nNext: review & apply patch manually (e.g., git apply ${opts.outDir}/fix.conservative.patch)`)
          );
          console.log(chalk.dim(`Or use --auto-heal to let Guardian fix it automatically\n`));
        }
      } else {
        console.log(chalk.dim(`\nNext: run with --show-options to generate patches\n`));
      }
    } catch (error: any) {
      console.error(chalk.red('\n[-] Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command("eval")
  .description("[>] Real-world evaluation harness across multiple failed runs")
  .requiredOption("-r, --repo <owner/repo>", "Target repository")
  .option("--run-ids <ids>", "Comma-separated run IDs (e.g. 123,456,789)")
  .option("--run-file <path>", "Path to file with run IDs (JSON array or newline/comma text)")
  .option("--failed-limit <n>", "Use N most recent failed runs when IDs are not provided", "5")
  .option("--max-log-chars <n>", "Maximum failed-log characters to analyze", "12000")
  .option("--fast", "Fast mode for each evaluated run")
  .option("--fail-fast", "Stop harness on first failed case")
  .option("--out-dir <path>", "Output directory for evaluation reports", ".copilot-guardian/eval")
  .action(async (opts) => {
    try {
      const repo = opts.repo as string;
      const maxLogChars = Number(opts.maxLogChars);
      if (!Number.isFinite(maxLogChars) || maxLogChars < 2000) {
        throw new Error("--max-log-chars must be a number >= 2000");
      }

      const failedLimit = Number(opts.failedLimit);
      if (!Number.isFinite(failedLimit) || failedLimit < 1) {
        throw new Error("--failed-limit must be a number >= 1");
      }

      const fromOption = opts.runIds ? parseRunIds(String(opts.runIds)) : [];
      const fromFile = opts.runFile ? parseRunIdsFile(String(opts.runFile)) : [];
      let runIds = Array.from(new Set([...fromOption, ...fromFile]));

      if (runIds.length === 0) {
        runIds = await getRecentFailedRunIds(repo, failedLimit);
      }

      if (runIds.length === 0) {
        throw new Error("No run IDs resolved. Provide --run-ids or --run-file.");
      }

      console.log(chalk.bold("\n=== Guardian Evaluation Plan ===\n"));
      console.log(chalk.dim(`Repo: ${repo}`));
      console.log(chalk.dim(`Run IDs: ${runIds.join(", ")}`));
      console.log(chalk.dim(`Out: ${opts.outDir}\n`));

      const report = await runEvaluationHarness(repo, runIds, {
        outDir: String(opts.outDir),
        maxLogChars,
        failFast: Boolean(opts.failFast),
        fast: Boolean(opts.fast)
      });

      console.log(chalk.green.bold("[+] Evaluation summary"));
      console.log(chalk.dim(`    Analyze success: ${report.summary.analyze_success_rate}%`));
      console.log(chalk.dim(`    Patch generation: ${report.summary.patch_generation_rate}%`));
      console.log(chalk.dim(`    Patchable (>=1 GO): ${report.summary.patchable_rate}%`));
      console.log(chalk.dim(`    All NO_GO: ${report.summary.all_no_go_rate}%`));
      console.log(chalk.dim(`    Report: ${report.options.out_dir}/eval.report.md\n`));
    } catch (error: any) {
      console.error(chalk.red("\n[-] Error:"), error.message);
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("[>] Fetch logs and produce a structured multi-hypothesis diagnosis")
  .requiredOption("-r, --repo <owner/repo>", "Target repository")
  .requiredOption("-i, --run-id <id>", "Run ID")
  .option("--max-log-chars <n>", "Maximum failed-log characters to analyze", "12000")
  .option("--fast", "Fast mode: shorter model timeout + reduced source fetch")
  .option("--out-dir <path>", "Output directory", ".copilot-guardian")
  .action(async (opts) => {
    try {
      const maxLogChars = Number(opts.maxLogChars);
      if (!Number.isFinite(maxLogChars) || maxLogChars < 2000) {
        throw new Error("--max-log-chars must be a number >= 2000");
      }
      await analyzeRun(opts.repo, Number(opts.runId), opts.outDir, maxLogChars, {
        fast: Boolean(opts.fast)
      });
      console.log(chalk.green(`\n[+] Analysis saved to ${opts.outDir}/analysis.json\n`));
    } catch (error: any) {
      console.error(chalk.red('\n[-] Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command("debug")
  .description("[>] Interactive Copilot-in-the-loop debugging")
  .requiredOption("-r, --repo <owner/repo>", "Target repository")
  .option("-i, --run-id <id>", "Run ID")
  .option("--last-failed", "Auto-select most recent failed run")
  .option("--out-dir <path>", "Output directory", ".copilot-guardian")
  .action(async (opts) => {
    try {
      const repo = opts.repo as string;
      let runId: number;
      
      if (opts.lastFailed) {
        runId = await getLastFailedRunId(repo);
      } else if (opts.runId) {
        runId = Number(opts.runId);
      } else {
        throw new Error("Provide --run-id or --last-failed");
      }

      renderHeader(repo, runId);
      await debugInteractive(repo, runId, opts.outDir);
      console.log(chalk.green(`\n[+] Debug transcript saved to ${opts.outDir}/debug.transcript.md\n`));
    } catch (error: any) {
      console.error(chalk.red('\n[-] Error:'), error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
