import { describe, it, expect } from 'vitest';
import { runHandoffFixture } from '../src/eval/workflow-fixtures.js';

describe('CrewBench workflow fixtures', () => {
  it('handoff: happy path emits ready-for-review shape', async () => {
    const session = await runHandoffFixture();

    expect(session.success).toBe(true);
    expect(session.artefacts['jiraTransition']).toBe('In Review');
    expect(session.artefacts['terminalStep']).toBe('in-review');

    const handoff = session.artefacts['handoffEvent'] as { issueKey: string; mrUrl: string };
    expect(handoff.issueKey).toBe(session.artefacts['issueKey']);
    expect(handoff.mrUrl).toBe(session.artefacts['mrUrl']);
    expect(handoff.mrUrl).toMatch(/^https:\/\//);
  });
});

describe('CrewBench eval HTTP integration', () => {
  it('handoff eval passes against mock eval server', async () => {
    const { runEvalFile } = await import('@daddia/crew/evals');
    const { startEvalServer } = await import('../src/eval/start-server.js');
    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const crewDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const server = await startEvalServer();

    try {
      const result = await runEvalFile({
        filePath: join(crewDir, 'evals', 'handoff.eval.ts'),
        crewDir,
        baseUrl: server.baseUrl,
        strict: true,
      });
      expect(result.passed).toBe(true);
    } finally {
      await server.close();
    }
  });
});
