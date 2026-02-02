import { execAsync, ghAsync, copilotChatAsync } from '../src/engine/async-exec';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');

describe('async-exec.ts', () => {
  let mockProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock process
    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = jest.fn();
    
    (spawn as jest.Mock).mockReturnValue(mockProcess);
  });

  describe('execAsync', () => {
    test('resolves with stdout on success', async () => {
      const promise = execAsync('test-command', ['arg1'], { timeout: 5000 });
      
      // Simulate successful output
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('test output'));
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await promise;
      expect(result).toContain('test output');
    });

    test('rejects on non-zero exit code', async () => {
      const promise = execAsync('test-command', ['arg1'], { timeout: 5000 });
      
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('error message'));
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(promise).rejects.toThrow('error message');
    });

    test('rejects on timeout', async () => {
      const promise = execAsync('test-command', ['arg1'], { timeout: 100 });
      
      // Don't emit close event - let it timeout
      
      await expect(promise).rejects.toThrow('timeout');
    });

    test('shows spinner when showSpinner=true', async () => {
      const promise = execAsync('test-command', ['arg1'], { 
        showSpinner: true,
        spinnerText: 'Testing...'
      });
      
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);
      
      await promise;
      
      // Spinner should have been created
      expect(spawn).toHaveBeenCalledWith('test-command', ['arg1'], expect.any(Object));
    });

    test('handles retry on failure', async () => {
      let attempts = 0;
      
      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();
        
        setTimeout(() => {
          attempts++;
          if (attempts < 3) {
            proc.emit('close', 1); // Fail first 2 times
          } else {
            proc.emit('close', 0); // Succeed on 3rd attempt
          }
        }, 10);
        
        return proc;
      });
      
      const result = await execAsync('test-command', ['arg1'], { 
        retry: 3,
        retryDelay: 10
      });
      
      expect(attempts).toBe(3);
      expect(spawn).toHaveBeenCalledTimes(3);
    });
  });

  describe('ghAsync', () => {
    test('calls gh CLI with correct args', async () => {
      const promise = ghAsync(['repo', 'view']);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('repo data'));
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await promise;
      
      expect(spawn).toHaveBeenCalledWith('gh', ['repo', 'view'], expect.any(Object));
      expect(result).toContain('repo data');
    });

    test('handles gh auth errors', async () => {
      const promise = ghAsync(['repo', 'view']);
      
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('not logged in'));
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(promise).rejects.toThrow('not logged in');
    });
  });

  describe('copilotChatAsync', () => {
    test('sends prompt to gh copilot', async () => {
      const promise = copilotChatAsync('test prompt');
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('copilot response'));
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await promise;
      
      expect(spawn).toHaveBeenCalledWith('gh', ['copilot', 'chat', '--question', 'test prompt'], expect.any(Object));
      expect(result).toContain('copilot response');
    });

    test('handles rate limit errors', async () => {
      const promise = copilotChatAsync('test prompt');
      
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('rate limit exceeded'));
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(promise).rejects.toThrow();
    });

    test('shows spinner during long operation', async () => {
      const promise = copilotChatAsync('test prompt', { showSpinner: true });
      
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);
      
      await promise;
      
      expect(spawn).toHaveBeenCalled();
    });

    test('handles timeout gracefully', async () => {
      const promise = copilotChatAsync('test prompt', { timeout: 100 });
      
      // Don't emit close - let it timeout
      
      await expect(promise).rejects.toThrow('timeout');
    });
  });

  describe('Error handling', () => {
    test('distinguishes timeout errors', async () => {
      const promise = execAsync('slow-command', [], { timeout: 50 });
      
      try {
        await promise;
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toMatch(/timeout/i);
      }
    });

    test('provides context in error messages', async () => {
      const promise = execAsync('test-command', ['arg1'], { timeout: 5000 });
      
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('specific error'));
        mockProcess.emit('close', 1);
      }, 10);
      
      try {
        await promise;
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('specific error');
      }
    });
  });
});
