import fs from "node:fs";
import path from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

export type ExecOptions = {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
};

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

export function writeText(p: string, content: string): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

export function writeJson(p: string, obj: unknown): void {
  writeText(p, JSON.stringify(obj, null, 2));
}

export function redactSecrets(text: string): string {
  const patterns: RegExp[] = [
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9_]{82}/g,
    /ghs_[a-zA-Z0-9]{36}/g,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    /sk-[a-zA-Z0-9]{48}/g,
    /(token|password|secret|key)\s*[:=]\s*[^\s]+/gi,
    /\b[A-Za-z0-9+/]{40,}\b/g
  ];

  let redacted = text;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, "***REDACTED***");
  }
  return redacted;
}

export function extractJsonObject(text: string): string {
  // Allow Copilot to wrap JSON in markdown fences; find the first { ... } blob.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Copilot response");
  return match[0];
}

export function validateJson(data: unknown, schemaPath: string): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(loadText(schemaPath));
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    const errors = (validate.errors || [])
      .map((e) => `${e.instancePath || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`Schema validation failed (${schemaPath}):\n${errors}`);
  }
}

export function clampText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n... [truncated]";
}
