import path from "node:path";
import { execSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { analyzeRun } from "./analyze";
import { generatePatchOptions } from "./patch_options";
import { ensureDir, loadText, writeText, extractJsonObject, validateJson } from "./util";

function copilotChat(payload: string): string {
  try {
    return execSync("gh copilot chat --quiet", {
      input: payload,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8"
    }) as unknown as string;
  } catch (e: any) {
    const stderr = e?.stderr ? String(e.stderr) : "";
    throw new Error(`Copilot CLI failed.\n${stderr}`);
  }
}

export async function debugInteractive(repo: string, runId: number, outDir = path.join(process.cwd(), ".copilot-guardian")) {
  ensureDir(outDir);

  const { analysis, ctx } = await analyzeRun(repo, runId, outDir);

  const rl = readline.createInterface({ input, output });
  const transcriptPath = path.join(outDir, "debug.transcript.md");
  writeText(transcriptPath, `# copilot-guardian debug transcript\n\nRepo: ${repo}\nRun: ${runId}\n\n`);

  // Thin interactive layer: ask follow-ups, then optionally generate patch spectrum.
  while (true) {
    output.write("\nChoose an action:\n");
    output.write("  1) Ask Copilot a follow-up question\n");
    output.write("  2) Generate patch options (Conservative/Balanced/Aggressive)\n");
    output.write("  3) Exit\n\n");

    const choice = (await rl.question("Your choice (1-3): ")).trim();

    if (choice === "3") break;

    if (choice === "2") {
      await generatePatchOptions(analysis, outDir);
      output.write(`\n✔ Patch options generated. See: ${path.join(outDir, "patch_options.json")}\n`);
      continue;
    }

    if (choice !== "1") {
      output.write("Invalid choice.\n");
      continue;
    }

    const q = (await rl.question("\nAsk Copilot: ")).trim();
    if (!q) continue;

    const prompt = loadText(path.join(process.cwd(), "prompts", "debug.followup.v1.txt"));
    const payload = `${prompt}\n\nCONTEXT:\n${JSON.stringify({
      repo,
      run_id: runId,
      selected: analysis.diagnosis.selected_hypothesis_id,
      root_cause: analysis.diagnosis.root_cause,
      log_excerpt: ctx.logExcerpt
    }, null, 2)}\n\nQUESTION:\n${q}`;

    const raw = copilotChat(payload);
    writeText(path.join(outDir, "copilot.debug.followup.raw.txt"), raw);

    const obj = JSON.parse(extractJsonObject(raw));
    if (typeof obj.answer !== "string" || typeof obj.next_check !== "string" || typeof obj.confidence !== "number") {
      throw new Error("Invalid follow-up JSON from Copilot (expected {answer, confidence, next_check})");
    }

    // Append transcript
    const snippet = `\n## Q: \n\n\n\n- confidence: \n- next_check: \n`;
    writeText(transcriptPath, loadText(transcriptPath) + snippet);

    output.write(`\nCopilot: \nNext check: \n`);
  }

  rl.close();
  return { outDir, analysis };
}
