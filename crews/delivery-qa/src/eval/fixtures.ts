import type { EvalFixtureRunner, EvalSessionResult } from '@daddia/crew/evals';
import { runHandoffFixture } from './workflow-fixtures.js';

export type EvalFixtureMode = 'mock' | 'live';

async function runSmokeFixtureLive(): Promise<EvalSessionResult> {
  const { qaEngineer } = await import('../agents/qa-engineer/agent.js');
  const result = await qaEngineer.run({
    issueKey: 'EVAL-SMOKE',
    context: {
      task: 'CrewBench smoke eval — confirm submit_result path works.',
    },
  });
  const sessionId =
    typeof result.artefacts['sessionId'] === 'string' ? result.artefacts['sessionId'] : undefined;
  return {
    success: result.success,
    summary: result.summary,
    artefacts: result.artefacts,
    costUsd: result.costUsd,
    sessionId,
  };
}

function runSmokeFixtureMock(): EvalSessionResult {
  return {
    success: true,
    summary: 'Smoke fixture session completed',
    artefacts: { fixture: 'smoke', mode: 'mock' },
    costUsd: 0,
    sessionId: 'eval-smoke-fixture',
  };
}

/** Fixture used when gate assertions must fail in CI. */
export async function runFailureFixture(): Promise<EvalSessionResult> {
  return {
    success: false,
    summary: 'Fixture session failed by design',
    artefacts: { fixture: 'failure' },
    costUsd: 0,
  };
}

/** Build eval fixture runners; mode is resolved from config.ts at boot. */
export function createEvalFixtures(mode: EvalFixtureMode): Record<string, EvalFixtureRunner> {
  return {
    smoke: async () => (mode === 'live' ? runSmokeFixtureLive() : runSmokeFixtureMock()),
    failure: runFailureFixture,
    handoff: runHandoffFixture,
  };
}
