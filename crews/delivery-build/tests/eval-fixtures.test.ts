import { describe, it, expect } from 'vitest';
import {
  runHandoffArtefactFixture,
  runLoopCapEscalationFixture,
  runToolAllowlistDenialFixture,
} from '../src/eval/workflow-fixtures.js';

describe('CrewBench workflow fixtures', () => {
  it('loop-cap-escalation: peer review never passes until cap, then Needs human review', async () => {
    const session = await runLoopCapEscalationFixture();

    expect(session.artefacts['jiraTransition']).toBe('Needs human review');
    expect(session.artefacts['mrOpened']).toBe(false);
    expect(session.artefacts['peerReviewIterations']).toBe(
      (session.artefacts['refactorLoopCap'] as number) + 1,
    );
    expect(session.artefacts['escalationReason']).toBe('Refactor loop cap reached');
  });

  it('tool-allowlist-denial: merge tool denied by pre-execution guard', async () => {
    const session = await runToolAllowlistDenialFixture();

    expect(session.artefacts['allowlistEnforced']).toBe(true);
    expect(session.artefacts['deniedTool']).toBe('mcp__gitlab__merge_merge_request');
    const denial = session.artefacts['denial'] as { tool: string; reason: string };
    expect(denial.tool).toBe('mcp__gitlab__merge_merge_request');
    expect(denial.reason).toContain('not in the allowed list');
  });

  it('handoff-artefact: happy path emits ready-for-qa shape', async () => {
    const session = await runHandoffArtefactFixture();

    expect(session.success).toBe(true);
    expect(session.artefacts['jiraTransition']).toBe('In QA');
    expect(session.artefacts['terminalStep']).toBe('in-qa');

    const handoff = session.artefacts['handoffEvent'] as { issueKey: string; mrUrl: string };
    expect(handoff.issueKey).toBe(session.artefacts['issueKey']);
    expect(handoff.mrUrl).toBe(session.artefacts['mrUrl']);
    expect(handoff.mrUrl).toMatch(/^https:\/\//);
  });
});

describe('CrewBench eval HTTP integration', () => {
  it('loop-cap-escalation eval passes against mock eval server', async () => {
    const { runEvalFile } = await import('@daddia/crew/evals');
    const { startEvalServer } = await import('../src/eval/start-server.js');
    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const crewDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const server = await startEvalServer();

    try {
      const result = await runEvalFile({
        filePath: join(crewDir, 'evals', 'loop-cap-escalation.eval.ts'),
        crewDir,
        baseUrl: server.baseUrl,
      });
      expect(result.passed).toBe(true);
    } finally {
      await server.close();
    }
  });
});
