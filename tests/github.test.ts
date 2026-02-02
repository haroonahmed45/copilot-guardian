import { fetchRunContext } from '../src/engine/github';
import * as asyncExec from '../src/engine/async-exec';

jest.mock('../src/engine/async-exec');

describe('github.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchRunContext', () => {
    test('fetches complete run context', async () => {
      (asyncExec.ghAsync as jest.Mock)
        .mockResolvedValueOnce('12345') // run ID
        .mockResolvedValueOnce('failed\nError: API_URL is not defined') // logs
        .mockResolvedValueOnce('.github/workflows/ci.yml') // workflow path
        .mockResolvedValueOnce('name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest'); // workflow YAML

      const context = await fetchRunContext('test/repo', 12345);

      expect(context.repo).toBe('test/repo');
      expect(context.runId).toBe(12345);
      expect(context.logExcerpt).toContain('API_URL');
      expect(context.workflowYaml).toContain('CI');
    });

    test('handles missing workflow file', async () => {
      (asyncExec.ghAsync as jest.Mock)
        .mockResolvedValueOnce('12345')
        .mockResolvedValueOnce('Error log')
        .mockResolvedValueOnce('') // No workflow path
        .mockResolvedValueOnce('');

      const context = await fetchRunContext('test/repo', 12345);

      expect(context.workflowPath).toBe('');
      expect(context.workflowYaml).toBe('');
    });

    test('retries on transient errors', async () => {
      (asyncExec.ghAsync as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('12345')
        .mockResolvedValueOnce('logs')
        .mockResolvedValueOnce('.github/workflows/ci.yml')
        .mockResolvedValueOnce('yaml content');

      const context = await fetchRunContext('test/repo', 12345);

      expect(context.runId).toBe(12345);
      expect(asyncExec.ghAsync).toHaveBeenCalledTimes(5); // 1 retry + 4 calls
    });

    test('respects timeout settings', async () => {
      (asyncExec.ghAsync as jest.Mock).mockImplementation(() => 
        new Promise((resolve) => setTimeout(() => resolve('data'), 100))
      );

      const promise = fetchRunContext('test/repo', 12345);

      await expect(promise).resolves.toBeDefined();
    });

    test('extracts relevant log excerpt', async () => {
      const longLog = 'Setup: OK\n' + 'Installing: OK\n' + 'Error: API_URL is not defined\n' + 'Exit code: 1\n'.repeat(100);

      (asyncExec.ghAsync as jest.Mock)
        .mockResolvedValueOnce('12345')
        .mockResolvedValueOnce(longLog)
        .mockResolvedValueOnce('.github/workflows/ci.yml')
        .mockResolvedValueOnce('yaml');

      const context = await fetchRunContext('test/repo', 12345);

      expect(context.logExcerpt.length).toBeLessThan(longLog.length);
      expect(context.logExcerpt).toContain('API_URL');
    });

    test('handles gh CLI not authenticated', async () => {
      (asyncExec.ghAsync as jest.Mock).mockRejectedValue(
        new Error('gh auth login required')
      );

      await expect(
        fetchRunContext('test/repo', 12345)
      ).rejects.toThrow('auth');
    });

    test('handles invalid repo format', async () => {
      (asyncExec.ghAsync as jest.Mock).mockRejectedValue(
        new Error('repository not found')
      );

      await expect(
        fetchRunContext('invalid-repo', 12345)
      ).rejects.toThrow('not found');
    });

    test('handles rate limiting', async () => {
      (asyncExec.ghAsync as jest.Mock).mockRejectedValue(
        new Error('rate limit exceeded')
      );

      await expect(
        fetchRunContext('test/repo', 12345)
      ).rejects.toThrow('rate limit');
    });

    test('calls ghAsync with correct arguments', async () => {
      (asyncExec.ghAsync as jest.Mock)
        .mockResolvedValueOnce('12345')
        .mockResolvedValueOnce('logs')
        .mockResolvedValueOnce('.github/workflows/ci.yml')
        .mockResolvedValueOnce('yaml');

      await fetchRunContext('owner/repo', 99999);

      expect(asyncExec.ghAsync).toHaveBeenCalledWith(
        expect.arrayContaining(['run', 'view']),
        expect.any(Object)
      );
    });

    test('includes run metadata', async () => {
      (asyncExec.ghAsync as jest.Mock)
        .mockResolvedValueOnce('12345')
        .mockResolvedValueOnce('failed\nError: test')
        .mockResolvedValueOnce('.github/workflows/ci.yml')
        .mockResolvedValueOnce('name: CI');

      const context = await fetchRunContext('test/repo', 12345);

      expect(context).toHaveProperty('repo');
      expect(context).toHaveProperty('runId');
      expect(context).toHaveProperty('logExcerpt');
      expect(context).toHaveProperty('workflowPath');
      expect(context).toHaveProperty('workflowYaml');
    });
  });
});
