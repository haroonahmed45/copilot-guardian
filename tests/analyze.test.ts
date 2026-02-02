import { analyzeRun } from '../src/engine/analyze';
import * as github from '../src/engine/github';
import * as asyncExec from '../src/engine/async-exec';
import * as mcp from '../src/engine/mcp';

// Mock dependencies
jest.mock('../src/engine/github');
jest.mock('../src/engine/async-exec');
jest.mock('../src/engine/mcp');

describe('analyze.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    (github.fetchRunContext as jest.Mock).mockResolvedValue({
      repo: 'test/repo',
      runId: 123,
      logExcerpt: 'Error: API_URL is not defined',
      logSummary: 'API_URL error',
      workflowYaml: 'env:\n  NODE_ENV: test'
    });
    
    (mcp.ensureMCPConfigured as jest.Mock).mockResolvedValue(true);
    (mcp.enhancePromptWithMCP as jest.Mock).mockImplementation((prompt) => prompt);
    (mcp.saveMCPUsageLog as jest.Mock).mockImplementation(() => {});
    
    (asyncExec.copilotChatAsync as jest.Mock).mockResolvedValue(`{
      "diagnosis": {
        "hypotheses": [
          {
            "id": "H1",
            "title": "Missing environment variable",
            "category": "environment",
            "confidence": 0.89,
            "evidence": ["API_URL not defined"],
            "disconfirming": [],
            "next_check": "Review workflow env"
          },
          {
            "id": "H2",
            "title": "Node version mismatch",
            "category": "dependency",
            "confidence": 0.08,
            "evidence": [],
            "disconfirming": ["Setup succeeded"],
            "next_check": "Check package.json"
          },
          {
            "id": "H3",
            "title": "Network timeout",
            "category": "network",
            "confidence": 0.03,
            "evidence": [],
            "disconfirming": ["No timeout signals"],
            "next_check": "Check logs"
          }
        ],
        "selected_hypothesis_id": "H1",
        "category": "environment",
        "root_cause": "API_URL is missing",
        "evidence": ["Log shows API_URL undefined"],
        "confidence": {"score": 0.89, "rationale": "Clear error message"}
      },
      "patch_plan": {
        "intent": "Add API_URL env var",
        "allowed_files": [".github/workflows/ci.yml"],
        "strategy": ["Add env var to workflow"]
      }
    }`);
  });

  test('analyzeRun returns multi-hypothesis analysis', async () => {
    const result = await analyzeRun('test/repo', 123, '.copilot-guardian-test');
    
    expect(result.analysis.diagnosis.hypotheses).toHaveLength(3);
    expect(result.analysis.diagnosis.hypotheses[0].id).toBe('H1');
    expect(result.analysis.diagnosis.hypotheses[0].confidence).toBeGreaterThan(0.5);
    expect(result.analysis.diagnosis.selected_hypothesis_id).toBe('H1');
  });

  test('analyzeRun calls fetchRunContext', async () => {
    await analyzeRun('test/repo', 456, '.copilot-guardian-test');
    
    expect(github.fetchRunContext).toHaveBeenCalledWith('test/repo', 456);
  });

  test('analyzeRun configures MCP', async () => {
    await analyzeRun('test/repo', 789, '.copilot-guardian-test');
    
    expect(mcp.ensureMCPConfigured).toHaveBeenCalled();
  });

  test('analyzeRun enhances prompt with MCP when available', async () => {
    (mcp.ensureMCPConfigured as jest.Mock).mockResolvedValue(true);
    
    await analyzeRun('test/repo', 123, '.copilot-guardian-test');
    
    expect(mcp.enhancePromptWithMCP).toHaveBeenCalled();
  });

  test('analyzeRun logs MCP usage when detected in response', async () => {
    (asyncExec.copilotChatAsync as jest.Mock).mockResolvedValue(`
      I accessed @github/runs/123 via MCP.
      {"diagnosis": {"hypotheses": [{"id": "H1", "title": "Test", "category": "test", "confidence": 1.0, "evidence": [], "disconfirming": [], "next_check": ""}], "selected_hypothesis_id": "H1", "category": "test", "root_cause": "test", "evidence": [], "confidence": {"score": 1.0, "rationale": "test"}}, "patch_plan": {"intent": "test", "allowed_files": [], "strategy": []}}
    `);
    
    await analyzeRun('test/repo', 123, '.copilot-guardian-test');
    
    expect(mcp.saveMCPUsageLog).toHaveBeenCalled();
  });

  test('analyzeRun handles Copilot errors gracefully', async () => {
    (asyncExec.copilotChatAsync as jest.Mock).mockRejectedValue(
      new Error('Copilot timeout')
    );
    
    await expect(
      analyzeRun('test/repo', 123, '.copilot-guardian-test')
    ).rejects.toThrow('Copilot timeout');
  });

  test('analyzeRun validates hypothesis structure', async () => {
    const result = await analyzeRun('test/repo', 123, '.copilot-guardian-test');
    
    const h1 = result.analysis.diagnosis.hypotheses[0];
    expect(h1).toHaveProperty('id');
    expect(h1).toHaveProperty('title');
    expect(h1).toHaveProperty('category');
    expect(h1).toHaveProperty('confidence');
    expect(h1).toHaveProperty('evidence');
    expect(h1).toHaveProperty('disconfirming');
    expect(h1).toHaveProperty('next_check');
  });
});
