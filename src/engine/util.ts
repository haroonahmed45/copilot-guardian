import fs from "node:fs";
import path from "node:path";

import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// ESM default export handling
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

// Get current directory - works in both ESM and CommonJS environments
import { fileURLToPath } from 'node:url';

const getCurrentDir = (): string => {
  // In CommonJS (Jest tests), __dirname is defined
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  // In ESM (runtime with NodeNext), import.meta.url is available
  // @ts-ignore - import.meta is available in ESM modules
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    // @ts-ignore
    return path.dirname(fileURLToPath(import.meta.url));
  }
  // Fallback: assume we're in the project root
  return process.cwd();
};

// Get package root directory (works for both local dev and global install)
// In compiled code: __dirname = dist/engine, so we go up 2 levels to get package root
// In source: __dirname = src/engine, so we go up 2 levels to get package root
export const PACKAGE_ROOT = path.resolve(getCurrentDir(), '..', '..');

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
    // GitHub tokens
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9_]{82}/g,
    /ghs_[a-zA-Z0-9]{36}/g,
    // Bearer tokens
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    // OpenAI keys
    /sk-[a-zA-Z0-9]{48}/g,
    // Generic secrets (key=value pattern)
    /(token|password|secret|api_key|apikey|auth)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi,
    // AWS keys
    /AKIA[0-9A-Z]{16}/g,
    // Private keys
    /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)?\s*PRIVATE\s+KEY-----/g,
  ];
  // NOTE: Removed over-aggressive 40+ char alphanumeric pattern (S5 fix)
  // It was redacting git SHAs, npm hashes, and other diagnostic data

  let redacted = text;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, "***REDACTED***");
  }
  return redacted;
}

export function extractJsonObject(text: string): string {
  // S4 FIX: Use non-greedy matching with balanced brace counting
  // Find first { and match to its balanced closing }
  const startIdx = text.indexOf('{');
  if (startIdx === -1) throw new Error("No JSON object found in Copilot response");
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  
  // Fallback: return from first { to end (may be truncated JSON)
  throw new Error("Unbalanced JSON object in Copilot response - missing closing brace");
}

export function validateJson(data: unknown, schemaPath: string): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(loadText(schemaPath));
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    const errors = (validate.errors || [])
      .map((e: { instancePath?: string; message?: string }) => `${e.instancePath || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`Schema validation failed (${schemaPath}):\n${errors}`);
  }
}

export function clampText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n... [truncated]";
}
