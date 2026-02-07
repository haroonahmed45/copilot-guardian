import { spawn } from 'child_process';
import ora, { Ora } from 'ora';
import chalk from 'chalk';

export interface ExecOptions {
  showSpinner?: boolean;
  spinnerText?: string;
  timeout?: number;
  retries?: number;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

export class CopilotError extends Error {
  constructor(message: string) {
    super(`Copilot CLI error: ${message}`);
    this.name = 'CopilotError';
  }
}

/**
 * Execute command asynchronously with optional spinner
 */
export async function execAsync(
  command: string,
  args: string[],
  input?: string,
  options: ExecOptions = {}
): Promise<string> {
  const {
    showSpinner = true,
    spinnerText = 'Executing...',
    timeout = 120000
  } = options;

  const spinner: Ora | null = showSpinner ? ora(spinnerText).start() : null;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timer = timeout ? setTimeout(() => {
      proc.kill();
      spinner?.fail('Timeout');
      reject(new TimeoutError(timeout));
    }, timeout) : null;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (spinner && stdout.length > 0) {
        const preview = stdout.slice(-50).replace(/\n/g, ' ');
        spinner.text = `${spinnerText} (${Math.round(stdout.length / 1024)}KB)`;
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('error', (error) => {
      if (timer) clearTimeout(timer);
      spinner?.fail('Command error');
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);

      if (code === 0) {
        spinner?.succeed();
        resolve(stdout);
      } else {
        spinner?.fail();

        if (stderr.includes('rate limit')) {
          reject(new RateLimitError());
        } else if (stderr.includes('not found') || stderr.includes('command not found')) {
          reject(new Error(`Command not found: ${command}. Please install it first.`));
        } else {
          reject(new Error(`Command failed (exit ${code}):\n${stderr}`));
        }
      }
    });

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/**
 * Execute with automatic retry on transient failures
 */
export async function execWithRetry(
  command: string,
  args: string[],
  input?: string,
  options: ExecOptions = {}
): Promise<string> {
  const maxRetries = options.retries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await execAsync(command, args, input, {
        ...options,
        spinnerText: attempt > 1
          ? `${options.spinnerText} (attempt ${attempt}/${maxRetries})`
          : options.spinnerText
      });
    } catch (error: any) {
      lastError = error;

      if (error instanceof RateLimitError) {
        console.log(chalk.yellow(`[!] Rate limited. Waiting 60s before retry ${attempt}/${maxRetries}...`));
        await sleep(60000);
        continue;
      }

      if (error instanceof TimeoutError) {
        console.log(chalk.yellow(`[!] Timeout. Retrying ${attempt}/${maxRetries}...`));
        await sleep(5000);
        continue;
      }

      throw error;
    }
  }

  throw lastError!;
}

/**
 * Call GitHub Copilot CLI with retry logic
 */
export async function copilotChatAsync(
  prompt: string,
  options: Partial<ExecOptions> = {}
): Promise<string> {
  const fullOptions: ExecOptions = {
    showSpinner: true,
    spinnerText: '[>] Asking Copilot CLI...',
    timeout: 90000,
    retries: 2,
    ...options
  };

  try {
    const result = await execWithRetry(
      'gh',
      ['copilot', 'chat', '--quiet'],
      prompt,
      fullOptions
    );

    return result;
  } catch (error: any) {
    // Null-safe error message access
    const errorMsg = error?.message || '';
    
    if (errorMsg.includes('not found')) {
      throw new CopilotError(
        'GitHub CLI not installed. Install: https://cli.github.com'
      );
    }

    if (errorMsg.includes('not authenticated')) {
      throw new CopilotError(
        'Not authenticated. Run: gh auth login'
      );
    }

    if (errorMsg.includes('copilot') && errorMsg.includes('not found')) {
      throw new CopilotError(
        'Copilot CLI not enabled. Install: gh extension install github/gh-copilot'
      );
    }

    throw error;
  }
}

/**
 * Call gh CLI command asynchronously
 */
export async function ghAsync(
  args: string[],
  options: Partial<ExecOptions> = {}
): Promise<string> {
  return execWithRetry(
    'gh',
    args,
    undefined,
    {
      showSpinner: false,
      timeout: 30000,
      retries: 2,
      ...options
    }
  );
}

/**
 * Sleep utility (exported for test mocking)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test if gh CLI is available
 */
export async function checkGHCLI(): Promise<boolean> {
  try {
    await execAsync('gh', ['--version'], undefined, {
      showSpinner: false,
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test if Copilot CLI is available
 */
export async function checkCopilotCLI(): Promise<boolean> {
  try {
    await execAsync('gh', ['copilot', '--version'], undefined, {
      showSpinner: false,
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}
