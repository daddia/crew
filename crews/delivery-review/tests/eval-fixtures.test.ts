import { describe, it, expect } from 'vitest';
import { runHandoffDoneFixture } from '../src/eval/workflow-fixtures.js';

describe('CrewBench workflow fixtures', () => {
  it('handoff-done: happy path emits Done handoff shape', async () => {
    const session = await runHandoffDoneFixture();

    expect(session.success).toBe(true);
    expect(session.artefacts['jiraTransition']).toBe('Done');
    expect(session.artefacts['terminalStep']).toBe('done');

    const handoff = session.artefacts['handoffDoneEvent'] as {
      issueKey: string;
      mrUrl: string;
      mergeCommitSha: string;
    };
    expect(handoff.issueKey).toBe(session.artefacts['issueKey']);
    expect(handoff.mrUrl).toBe(session.artefacts['mrUrl']);
    expect(handoff.mergeCommitSha).toBe(session.artefacts['mergeCommitSha']);
    expect(handoff.mrUrl).toMatch(/^https:\/\//);
    expect(handoff.mergeCommitSha.length).toBeGreaterThan(0);
  });
});

describe('CrewBench eval HTTP integration', () => {
  it('handoff-done eval passes against mock eval server', async () => {
    const { runEvalFile } = await import('@daddia/crew/evals');
    const { startEvalServer } = await import('../src/eval/start-server.js');
    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const crewDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const server = await startEvalServer();

    try {
      const result = await runEvalFile({
        filePath: join(crewDir, 'evals', 'handoff-done.eval.ts'),
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
