#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";

import { getLastFailedRunId } from "./engine/github.js";
import { runGuardian } from "./engine/run.js";
import { analyzeRun } from "./engine/analyze.js";
import { debugInteractive } from "./engine/debug.js";
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

const program = new Command();

program
  .name("copilot-guardian")
  .description(chalk.cyan("[#] Sovereign AI Guardian for GitHub Actions"))
  .version("0.1.4");

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
  .option("--auto-heal", "[W] Self-healing mode: auto-apply + commit + push + retry CI (max 3)")
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

      renderHeader(repo, runId);
      const res = await runGuardian(repo, runId, {
        showReasoning: Boolean(opts.showReasoning),
        showOptions: Boolean(opts.showOptions),
        strategy: opts.strategy,
        outDir: opts.outDir
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
          
          // Select best patch (GO verdict + lowest risk)
          const bestPatch = res.patchIndex.results.find((r: any) => r.verdict === 'GO');
          if (!bestPatch) {
            console.log(chalk.red('[-] No safe patch found (all NO-GO). Manual intervention required.\n'));
            process.exit(1);
          }
          
          console.log(chalk.cyan(`[>] Selected: ${bestPatch.label} (risk: ${bestPatch.risk_level})`));
          
          // Apply patch using git apply (safe method)
          try {
            const { applyPatchViaDiff, checkCIStatus } = await import('./engine/auto-apply.js');
            const { execAsync } = await import('./engine/async-exec.js');
            
            // Read patch content
            const fs = await import('fs/promises');
            const diffContent = await fs.readFile(bestPatch.patchPath, 'utf-8');
            
            const allowedFilesRaw = res.analysis?.patch_plan?.allowed_files ?? [];
            const allowedFiles = allowedFilesRaw.filter((f: any) => typeof f === "string" && f.trim().length > 0);

            if (allowedFiles.length === 0) {
              throw new Error("Allowlist is empty; refusing to apply patch.");
            }

            if (Array.isArray(bestPatch.files) && bestPatch.files.length > 0) {
              const unexpected = bestPatch.files.filter((f: any) => !allowedFiles.includes(f));
              if (unexpected.length > 0) {
                throw new Error(`Patch touches files outside allowlist: ${unexpected.join(", ")}`);
              }
            }

            // Apply with safety checks
            const modifiedFiles = await applyPatchViaDiff(diffContent, false, {
              allowedFiles,
              repoRoot: process.cwd()
            });
            
            // Commit changes
            await execAsync('git', ['add', ...modifiedFiles]);
            
            const commitMsg = `fix: Guardian auto-heal (${bestPatch.label})`;
            await execAsync('git', ['commit', '-m', commitMsg]);
            
            const commitSha = (await execAsync('git', ['rev-parse', 'HEAD'])).trim();
            
            console.log(chalk.green(`[+] Patch applied & committed: ${commitSha.substring(0, 7)}`));
            
            // Push and check CI
            await execAsync('git', ['push', 'origin', 'HEAD']);
            console.log(chalk.green('[+] Pushed to remote'));
            
            console.log(chalk.yellow('[~] Waiting for CI (30s)...'));
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Check CI status
            const ciStatus = await checkCIStatus(commitSha);
            
            if (ciStatus === 'passed') {
              console.log(chalk.green.bold('\n[W] VICTORY! Guardian healed the CI!\n'));
              console.log(chalk.cyan('    Sleep well. CI is green.\n'));
              process.exit(0);
            } else {
              console.log(chalk.yellow('\n[~] CI still running or failed. Check manually.\n'));
              process.exit(1);
            }
            
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
  .command("analyze")
  .description("[>] Fetch logs and produce a structured multi-hypothesis diagnosis")
  .requiredOption("-r, --repo <owner/repo>", "Target repository")
  .requiredOption("-i, --run-id <id>", "Run ID")
  .option("--out-dir <path>", "Output directory", ".copilot-guardian")
  .action(async (opts) => {
    try {
      await analyzeRun(opts.repo, Number(opts.runId), opts.outDir);
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
