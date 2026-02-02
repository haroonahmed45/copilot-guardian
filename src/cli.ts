#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";

import { getLastFailedRunId } from "./engine/github";
import { runGuardian } from "./engine/run";
import { analyzeRun } from "./engine/analyze";
import { debugInteractive } from "./engine/debug";
import { autoHeal } from "./engine/auto-apply";
import { renderHypotheses, renderPatchSpectrum, renderHeader, renderSummary } from "./ui/dashboard";
import { checkGHCLI, checkCopilotCLI } from "./engine/async-exec";

const program = new Command();

program
  .name("copilot-guardian")
  .description(chalk.cyan("[#] Sovereign AI Guardian for GitHub Actions"))
  .version("0.1.0");

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
      console.log(chalk.green("[+] GitHub Copilot CLI: Installed"));
    } else {
      console.log(chalk.red("[-] GitHub Copilot CLI: Not found"));
      console.log(chalk.dim("    Install: gh extension install github/gh-copilot"));
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
          
          // Read patch file and convert to applyable format
          const fs = await import('fs/promises');
          const patchContent = await fs.readFile(bestPatch.patchPath, 'utf-8');
          
          // Parse unified diff to extract file changes
          // (Simplified: in production, use a diff parser library)
          const patchData = parsePatchFile(patchContent);
          
          // Execute self-healing loop
          const healResult = await autoHeal(patchData, {
            maxRetries: 3,
            pushRemote: true,
            branch: 'main' // TODO: detect current branch
          });
          
          if (healResult.success && healResult.ciStatus === 'passed') {
            console.log(chalk.green.bold('\n[W] VICTORY! Guardian healed the CI failure.\n'));
            console.log(chalk.cyan('    Your code is fixed. Your CI is green. You can sleep peacefully.\n'));
            console.log(chalk.dim(`    Modified: ${healResult.filesModified.join(', ')}`));
            console.log(chalk.dim(`    Commit: ${healResult.commitSha}\n`));
            process.exit(0);
          } else {
            console.log(chalk.red.bold('\n[-] Auto-heal failed. Manual review needed.\n'));
            console.log(chalk.yellow('    Guardian tried its best. Time for human wisdom.\n'));
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

/**
 * Parse unified diff format to extract file modifications
 * (Simplified parser - production should use proper diff library)
 */
function parsePatchFile(patchContent: string): Array<{ file: string; content: string }> {
  const result: Array<{ file: string; content: string }> = [];
  const fileBlocks = patchContent.split(/^diff --git /gm).filter(Boolean);
  
  for (const block of fileBlocks) {
    const fileMatch = block.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!fileMatch) continue;
    
    const filePath = fileMatch[2];
    
    // Extract new content (lines starting with +, excluding ---)
    const lines = block.split('\n');
    const contentLines: string[] = [];
    let inHunk = false;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      if (inHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          contentLines.push(line.substring(1));
        } else if (!line.startsWith('-') && !line.startsWith('\\')) {
          contentLines.push(line);
        }
      }
    }
    
    result.push({
      file: filePath,
      content: contentLines.join('\n')
    });
  }
  
  return result;
}

program.parse(process.argv);
