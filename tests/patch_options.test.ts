import { generatePatchOptions } from '../src/engine/patch_options';
import * as asyncExec from '../src/engine/async-exec';

jest.mock('../src/engine/async-exec');

describe('patch_options.ts', () => {
  const mockAnalysis = {
    diagnosis: {
      hypotheses: [
        {
          id: 'H1',
          title: 'Missing environment variable',
          confidence: 0.89
        }
      ],
      selected_hypothesis_id: 'H1',
      root_cause: 'API_URL not defined'
    },
    patch_plan: {
      intent: 'Add missing API_URL',
      allowed_files: ['.github/workflows/ci.yml'],
      strategy: ['Add env var']
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock patch generation responses
    (asyncExec.copilotChatAsync as jest.Mock).mockImplementation((prompt: string) => {
      if (prompt.includes('Generate 3 patch strategies')) {
        return Promise.resolve(`{
          "strategies": [
            {
              "id": "conservative",
              "label": "CONSERVATIVE",
              "diff": "--- a/.github/workflows/ci.yml\\n+++ b/.github/workflows/ci.yml\\n@@ -21,3 +21,5 @@\\n       - name: Run tests\\n         run: npm test\\n+        env:\\n+          API_URL: https://api.example.com",
              "summary": "Add only missing API_URL"
            },
            {
              "id": "balanced",
              "label": "BALANCED",
              "diff": "--- a/.github/workflows/ci.yml\\n+++ b/.github/workflows/ci.yml\\n@@ -21,3 +21,7 @@\\n       - name: Run tests\\n         run: npm test\\n+        env:\\n+          API_URL: https://api.example.com\\n+          API_TIMEOUT: 30000",
              "summary": "Add API_URL + timeout"
            },
            {
              "id": "aggressive",
              "label": "AGGRESSIVE",
              "diff": "--- a/.github/workflows/ci.yml\\n+++ b/.github/workflows/ci.yml\\n@@ -21,3 +21,50 @@\\n       - name: Run tests\\n         run: npm test\\n+        env:\\n+          API_URL: https://api.example.com\\n+      - name: Validate environment\\n+        run: node scripts/validate-env.js",
              "summary": "Add validation layer"
            }
          ]
        }`);
      } else if (prompt.includes('quality review')) {
        return Promise.resolve(`{
          "verdict": "GO",
          "slop_score": 0.12,
          "risk_level": "low",
          "reasons": []
        }`);
      }
      return Promise.resolve('{}');
    });
  });

  describe('generatePatchOptions', () => {
    test('generates 3 patch strategies', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      expect(result.index.results).toHaveLength(3);
      expect(result.index.results[0].label).toBe('CONSERVATIVE');
      expect(result.index.results[1].label).toBe('BALANCED');
      expect(result.index.results[2].label).toBe('AGGRESSIVE');
    });

    test('calls copilotChatAsync for patch generation and quality reviews', async () => {
      await generatePatchOptions(mockAnalysis, '.test-output');
      
      // 1 call for all strategies + 3 quality reviews = 4 calls
      expect(asyncExec.copilotChatAsync).toHaveBeenCalledTimes(4);
    });

    test('performs quality review for each patch', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      result.index.results.forEach((r: any) => {
        expect(r).toHaveProperty('verdict');
        expect(r).toHaveProperty('slop_score');
        expect(r).toHaveProperty('risk_level');
      });
    });

    test('handles CONSERVATIVE strategy correctly', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const conservative = result.index.results.find((r: any) => r.label === 'CONSERVATIVE');
      expect(conservative).toBeDefined();
      expect(conservative.patchPath).toContain('fix.conservative.patch');
      expect(conservative.summary).toContain('API_URL');
    });

    test('handles BALANCED strategy correctly', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const balanced = result.index.results.find((r: any) => r.label === 'BALANCED');
      expect(balanced).toBeDefined();
      expect(balanced.patchPath).toContain('fix.balanced.patch');
      expect(balanced.summary).toContain('timeout');
    });

    test('handles AGGRESSIVE strategy correctly', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const aggressive = result.index.results.find((r: any) => r.label === 'AGGRESSIVE');
      expect(aggressive).toBeDefined();
      expect(aggressive.patchPath).toContain('fix.aggressive.patch');
    });

    test('detects slop in over-engineered patches', async () => {
      (asyncExec.copilotChatAsync as jest.Mock).mockImplementation((prompt: string) => {
        if (prompt.includes('Generate 3 patch strategies')) {
          return Promise.resolve(`{
            "strategies": [
              {"id": "conservative", "label": "CONSERVATIVE", "diff": "patch", "summary": "test"},
              {"id": "balanced", "label": "BALANCED", "diff": "patch", "summary": "test"},
              {"id": "aggressive", "label": "AGGRESSIVE", "diff": "patch", "summary": "test"}
            ]
          }`);
        }
        if (prompt.includes('quality review') && prompt.includes('aggressive')) {
          return Promise.resolve(`{
            "verdict": "NO_GO",
            "slop_score": 0.73,
            "risk_level": "high",
            "reasons": ["Over-engineered"]
          }`);
        }
        return Promise.resolve(`{
          "verdict": "GO",
          "slop_score": 0.12,
          "risk_level": "low",
          "reasons": []
        }`);
      });

      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const aggressive = result.index.results.find((r: any) => r.label === 'AGGRESSIVE');
      expect(aggressive.verdict).toBe('NO_GO');
      expect(aggressive.slop_score).toBeGreaterThan(0.6);
    });

    test('handles async errors gracefully', async () => {
      (asyncExec.copilotChatAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Copilot timeout')
      );

      await expect(
        generatePatchOptions(mockAnalysis, '.test-output')
      ).rejects.toThrow('Copilot timeout');
    });

    test('saves patch files', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      result.index.results.forEach((r: any) => {
        expect(r.patchPath).toBeDefined();
        expect(r.patchPath).toContain('.test-output');
        expect(r.patchPath).toContain('.patch');
      });
    });

    test('saves files to output directory', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      expect(result.index.results[0].patchPath).toContain('.test-output');
      expect(result.index.results[0].patchPath).toContain('fix.conservative.patch');
    });
  });

  describe('Quality review', () => {
    test('assigns GO verdict to minimal patches', async () => {
      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const conservative = result.index.results.find((r: any) => r.label === 'CONSERVATIVE');
      expect(conservative.verdict).toBe('GO');
      expect(conservative.slop_score).toBeLessThan(0.3);
    });

    test('flags high slop scores', async () => {
      (asyncExec.copilotChatAsync as jest.Mock).mockImplementation((prompt: string) => {
        if (prompt.includes('Generate 3 patch strategies')) {
          return Promise.resolve(`{
            "strategies": [
              {"id": "conservative", "label": "CONSERVATIVE", "diff": "patch", "summary": "test"},
              {"id": "balanced", "label": "BALANCED", "diff": "patch", "summary": "test"},
              {"id": "aggressive", "label": "AGGRESSIVE", "diff": "patch", "summary": "test"}
            ]
          }`);
        }
        if (prompt.includes('aggressive') && prompt.includes('quality')) {
          return Promise.resolve(`{
            "verdict": "NO_GO",
            "slop_score": 0.85,
            "risk_level": "high",
            "reasons": []
          }`);
        }
        return Promise.resolve(`{
          "verdict": "GO",
          "slop_score": 0.1,
          "risk_level": "low",
          "reasons": []
        }`);
      });

      const result = await generatePatchOptions(mockAnalysis, '.test-output');
      
      const aggressive = result.index.results.find((r: any) => r.label === 'AGGRESSIVE');
      expect(aggressive.slop_score).toBeGreaterThan(0.8);
      expect(aggressive.verdict).toBe('NO_GO');
    });
  });
});
