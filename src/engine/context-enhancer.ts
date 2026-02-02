/**
 * context-enhancer.ts
 * Deep Intelligence: Extract source files mentioned in errors for pinpoint diagnosis
 */

import { ghAsync } from './async-exec';
import chalk from 'chalk';

export interface SourceContext {
  file: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
}

/**
 * Extract file paths from error logs
 * Matches patterns like: "src/utils.ts:45", "./components/Button.tsx:12:5"
 */
function extractFilePaths(logExcerpt: string): Array<{ file: string; line?: number }> {
  const fileRegex = /(?:\.\/|src\/|tests?\/)?[\w\-./]+\.\w{2,4}(?::\d+)?/g;
  const matches = logExcerpt.match(fileRegex) || [];
  
  return matches
    .map(match => {
      const [file, line] = match.split(':');
      return { file, line: line ? parseInt(line, 10) : undefined };
    })
    .filter((v, i, a) => a.findIndex(t => t.file === v.file) === i) // Unique files only
    .slice(0, 5); // Limit to top 5 files
}

/**
 * Fetch source file content from GitHub at specific commit
 */
async function fetchSourceFile(
  repo: string,
  filePath: string,
  commitSha: string
): Promise<string | null> {
  try {
    const content = await ghAsync([
      'api',
      '-H', 'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/${filePath}?ref=${commitSha}`
    ], { showSpinner: false, timeout: 10000 });
    
    return content;
  } catch (error) {
    console.log(chalk.dim(`[~] Could not fetch ${filePath}`));
    return null;
  }
}

/**
 * Extract relevant lines around error location
 */
function extractContextLines(
  content: string,
  targetLine: number,
  contextRadius = 10
): { snippet: string; lineStart: number; lineEnd: number } {
  const lines = content.split('\n');
  const start = Math.max(0, targetLine - contextRadius - 1);
  const end = Math.min(lines.length, targetLine + contextRadius);
  
  const snippet = lines
    .slice(start, end)
    .map((line, idx) => {
      const lineNum = start + idx + 1;
      const marker = lineNum === targetLine ? '>>>' : '   ';
      return `${marker} ${lineNum.toString().padStart(4)}: ${line}`;
    })
    .join('\n');
  
  return { snippet, lineStart: start + 1, lineEnd: end };
}

/**
 * Enhance context by fetching source files mentioned in logs
 */
export async function enhanceContextWithSources(
  logExcerpt: string,
  repo: string,
  headSha?: string
): Promise<SourceContext[]> {
  if (!headSha) {
    console.log(chalk.yellow('[!] No commit SHA, skipping source enhancement'));
    return [];
  }
  
  console.log(chalk.dim('[>] Deep analysis: Extracting source context...'));
  
  const filePaths = extractFilePaths(logExcerpt);
  
  if (filePaths.length === 0) {
    console.log(chalk.dim('[~] No source files detected in logs'));
    return [];
  }
  
  console.log(chalk.dim(`[>] Found ${filePaths.length} potential files, fetching...`));
  
  const contexts: SourceContext[] = [];
  
  for (const { file, line } of filePaths) {
    const content = await fetchSourceFile(repo, file, headSha);
    
    if (!content) continue;
    
    if (line) {
      const { snippet, lineStart, lineEnd } = extractContextLines(content, line);
      contexts.push({ file, content: snippet, lineStart, lineEnd });
      console.log(chalk.green(`[+] Pinpointed: ${file}:${line}`));
    } else {
      // No specific line, include first 50 lines
      const snippet = content.split('\n').slice(0, 50).join('\n');
      contexts.push({ file, content: snippet });
      console.log(chalk.green(`[+] Captured: ${file}`));
    }
  }
  
  return contexts;
}

/**
 * Format source contexts for prompt injection
 */
export function formatSourceContextForPrompt(contexts: SourceContext[]): string {
  if (contexts.length === 0) return '';
  
  const formatted = contexts.map(ctx => {
    const location = ctx.lineStart 
      ? `(lines ${ctx.lineStart}-${ctx.lineEnd})` 
      : '(preview)';
    
    return `
--- SOURCE: ${ctx.file} ${location} ---
${ctx.content}
---
`;
  }).join('\n');
  
  return `
## DEEP CONTEXT: Source Files Referenced in Error

${formatted}

[!] Use the above source context to provide PINPOINT diagnosis of the root cause.
`;
}
