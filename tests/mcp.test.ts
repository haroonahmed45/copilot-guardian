import { 
  isMCPConfigured, 
  ensureMCPConfigured, 
  enhancePromptWithMCP,
  saveMCPUsageLog 
} from '../src/engine/mcp';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('child_process');

describe('mcp.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isMCPConfigured', () => {
    test('returns true when MCP config exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github']
          }
        }
      }));

      const result = isMCPConfigured();
      expect(result).toBe(true);
    });

    test('returns false when config file missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = isMCPConfigured();
      expect(result).toBe(false);
    });

    test('returns false when github server not configured', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        mcpServers: {}
      }));

      const result = isMCPConfigured();
      expect(result).toBe(false);
    });

    test('handles malformed config gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = isMCPConfigured();
      expect(result).toBe(false);
    });
  });

  describe('ensureMCPConfigured', () => {
    test('returns true if already configured', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        mcpServers: { github: {} }
      }));

      const result = await ensureMCPConfigured();
      expect(result).toBe(true);
    });

    test('creates config when missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {});

      const result = await ensureMCPConfigured();

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('handles npm install failure', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('npm install failed');
      });

      const result = await ensureMCPConfigured();
      expect(result).toBe(false);
    });
  });

  describe('enhancePromptWithMCP', () => {
    test('adds MCP instructions to prompt', () => {
      const basePrompt = 'Analyze this failure';
      
      const enhanced = enhancePromptWithMCP(basePrompt, 'owner/repo', 12345);

      expect(enhanced).toContain('MCP');
      expect(enhanced).toContain('@github');
      expect(enhanced).toContain('owner/repo');
      expect(enhanced).toContain('12345');
      expect(enhanced).toContain(basePrompt);
    });

    test('instructs Copilot to use @github server', () => {
      const enhanced = enhancePromptWithMCP('test', 'owner/repo', 12345);

      expect(enhanced).toContain('@github/runs/12345');
      expect(enhanced).toContain('@github/jobs');
      expect(enhanced).toContain('@github/repository/owner/repo');
    });

    test('provides fallback instructions', () => {
      const enhanced = enhancePromptWithMCP('test', 'owner/repo', 12345);

      expect(enhanced).toContain('If MCP is NOT available');
      expect(enhanced).toContain('INPUT');
    });
  });

  describe('saveMCPUsageLog', () => {
    test('creates new log file if not exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      saveMCPUsageLog('analysis', ['@github/runs/123'], '.test-output');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp_usage.log'),
        expect.stringContaining('@github/runs/123')
      );
    });

    test('appends to existing log file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
        { operation: 'previous', resources: ['@github/runs/111'] }
      ]));
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      saveMCPUsageLog('analysis', ['@github/runs/123'], '.test-output');

      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const written = JSON.parse(writeCall[1]);
      
      expect(written).toHaveLength(2);
      expect(written[1].operation).toBe('analysis');
    });

    test('includes timestamp and evidence message', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      saveMCPUsageLog('analysis', ['@github/runs/123'], '.test-output');

      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const written = JSON.parse(writeCall[1]);
      
      expect(written[0]).toHaveProperty('timestamp');
      expect(written[0]).toHaveProperty('evidence');
      expect(written[0].evidence).toContain('MCP was used');
    });

    test('handles write errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Should not throw
      expect(() => {
        saveMCPUsageLog('analysis', ['@github/runs/123'], '.test-output');
      }).not.toThrow();
    });
  });
});
