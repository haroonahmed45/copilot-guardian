import chalk from "chalk";

// ASCII-safe block characters for cross-platform compatibility
const BLOCK_FULL = '#';
const BLOCK_LIGHT = '-';

function bar(p: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(p * width)));
  return BLOCK_FULL.repeat(filled) + BLOCK_LIGHT.repeat(width - filled);
}

export function renderHeader(repo: string, runId: number): void {
  console.log("\n" + chalk.bold.bgCyan.black("  COPILOT-GUARDIAN  ") + "\n");
  console.log(`${chalk.bold("Repo:")} ${repo}`);
  console.log(`${chalk.bold("Run:")}  ${runId}`);
}

export function renderSummary(analysis: any): void {
  console.log("\n" + chalk.bold.bgRed(" [X] FAILURE DIAGNOSIS ") + "\n");
  console.log(`${chalk.bold("Root cause:")} ${analysis.diagnosis.root_cause}`);
  console.log(`${chalk.bold("Selected:")}  ${analysis.diagnosis.selected_hypothesis_id} (${analysis.diagnosis.confidence_score})`);
  console.log(`${chalk.bold("Intent:")}    ${analysis.patch_plan.intent}`);
}

export function renderHypotheses(hypotheses: any[]): void {
  console.log("\n" + chalk.bold.bgMagenta.white("  MULTI-HYPOTHESIS REASONING  ") + "\n");

  for (const h of hypotheses) {
    const pct = Math.round((h.confidence ?? 0) * 100);
    const b = bar(h.confidence ?? 0);

    console.log(`${chalk.bold.cyan(h.id)} ${chalk.bold.white(h.title)}`);
    console.log(`  Confidence: ${chalk.cyan(b)} ${chalk.cyan.bold(pct + "%")}`);
    console.log(`  Evidence: ${chalk.dim((h.evidence?.[0] || "").slice(0, 140))}`);
    if (h.next_check) {
      console.log(`  Next check: ${chalk.yellow((h.next_check || "").slice(0, 140))}`);
    }
    console.log("");
  }
  
  // Summary line
  const selected = hypotheses.find(h => h.confidence === Math.max(...hypotheses.map(x => x.confidence ?? 0)));
  if (selected) {
    console.log(chalk.green.bold(`[SELECTED] ${selected.id}: ${selected.title}`));
    console.log(chalk.dim(`Confidence: ${Math.round((selected.confidence ?? 0) * 100)}% - Highest among all hypotheses\n`));
  }
}

export function renderPatchSpectrum(index: any): void {
  console.log("\n" + chalk.bold.bgYellow.black("  PATCH SPECTRUM  ") + "\n");

  for (const r of index.results) {
    const badge = r.verdict === "GO" ? chalk.bgGreen.black(" GO ") : chalk.bgRed.white(" NO-GO ");

    const risk = r.risk_level === "low" ? chalk.green("low") : r.risk_level === "medium" ? chalk.yellow("medium") : chalk.red("high");

    const slopIndicator = r.slop_score > 0.5 ? chalk.red(` [SLOP: ${Math.round(r.slop_score * 100)}%]`) : "";

    console.log(`${chalk.bold(String(r.label).padEnd(15))} ${badge}  risk=${risk}${slopIndicator}`);
    console.log(`  patch:   ${chalk.dim(r.patchPath)}`);
    if (r.files && r.files.length > 0) {
      console.log(`  files:   ${chalk.dim(r.files.join(', '))}`);
    }
    if (r.summary) console.log(`  note:    ${chalk.dim(String(r.summary).slice(0, 160))}`);
    console.log("");
  }
  
  // Summary recommendation
  const goStrategies = index.results.filter((r: any) => r.verdict === 'GO');
  if (goStrategies.length > 0) {
    const recommended = goStrategies.find((r: any) => r.risk_level === 'low') || goStrategies[0];
    console.log(chalk.green.bold(`[RECOMMENDED] ${recommended.label}`));
    console.log(chalk.dim(`Reason: Lowest risk among GO strategies\n`));
  } else {
    console.log(chalk.yellow.bold('[!] No GO strategies available - all flagged for slop or high risk\n'));
  }
}
