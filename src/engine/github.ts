import chalk from "chalk";
import { ghAsync } from "./async-exec";
import { redactSecrets, clampText } from "./util";

export type RunContext = {
  repo: string;
  runId: number;
  workflowPath?: string;
  headSha?: string;
  job?: string;
  step?: string;
  exitCode?: number;
  logExcerpt: string;
  logSummary: string;
  workflowYaml?: string;
};

async function gh(args: string[]): Promise<string> {
  return ghAsync(args, {
    showSpinner: false,
    timeout: 30000
  });
}

export async function getLastFailedRunId(repo: string): Promise<number> {
  const out = (await gh([
    'run', 'list',
    '--repo', repo,
    '--status', 'failure',
    '--limit', '1',
    '--json', 'databaseId',
    '-q', '.[0].databaseId'
  ])).trim();
  
  const n = Number(out);
  if (!Number.isFinite(n)) {
    throw new Error(`Could not find failed run for ${repo}`);
  }
  return n;
}

export async function fetchRunContext(repo: string, runId: number, maxLogChars = 12000): Promise<RunContext> {
  console.log(chalk.dim('[>] Fetching logs...'));
  
  // 1) Logs (failed only)
  const rawLogs = await gh(['run', 'view', String(runId), '--repo', repo, '--log-failed']);
  const redacted = redactSecrets(rawLogs);
  const excerpt = clampText(redacted, maxLogChars);

  console.log(chalk.dim('[>] Fetching workflow metadata...'));
  
  // 2) Try to derive workflow path + head sha
  let workflowPath: string | undefined;
  let headSha: string | undefined;
  try {
    const runJson = await gh(['api', `repos/${repo}/actions/runs/${runId}`]);
    const obj = JSON.parse(runJson);
    workflowPath = obj?.path;
    headSha = obj?.head_sha;
  } catch {
    console.log(chalk.yellow('[!] Could not fetch workflow metadata'));
  }

  // 3) Optional: fetch workflow yaml (raw)
  let workflowYaml: string | undefined;
  if (workflowPath && headSha) {
    try {
      console.log(chalk.dim('[>] Fetching workflow YAML...'));
      workflowYaml = await gh([
        'api',
        '-H', 'Accept: application/vnd.github.raw',
        `repos/${repo}/contents/${workflowPath}?ref=${headSha}`
      ]);
    } catch {
      console.log(chalk.yellow('[!] Could not fetch workflow YAML'));
    }
  }

  // 4) Quick heuristic summary (first "Error:" line etc)
  const lines = excerpt.split(/\r?\n/);
  const errorLine = lines.find((l) => /error\b|failed\b|exception\b/i.test(l))?.trim();
  const logSummary = errorLine ? errorLine.slice(0, 240) : lines.slice(0, 3).join(" ").slice(0, 240);

  return {
    repo,
    runId,
    workflowPath,
    headSha,
    logExcerpt: excerpt,
    logSummary,
    workflowYaml
  };
}
