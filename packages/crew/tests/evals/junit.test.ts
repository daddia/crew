import { describe, it, expect } from 'vitest';
import { renderJUnit } from '../../src/evals/reporters/junit.js';
import type { EvalRunResult } from '../../src/evals/types.js';

function makeResult(overrides: Partial<EvalRunResult>): EvalRunResult {
  return {
    evalName: 'smoke',
    filePath: '/tmp/smoke.eval.ts',
    fixture: 'smoke',
    session: { success: true, summary: 'ok', artefacts: {}, costUsd: 0 },
    assertions: [],
    passed: true,
    durationMs: 10,
    ...overrides,
  };
}

describe('renderJUnit', () => {
  it('emits passing testcase', () => {
    const xml = renderJUnit([makeResult({})]);
    expect(xml).toContain('tests="1"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('name="smoke"');
    expect(xml).not.toContain('<failure');
  });

  it('emits failure for gate assertion miss', () => {
    const xml = renderJUnit([
      makeResult({
        passed: false,
        session: { success: false, summary: 'no', artefacts: {}, costUsd: 0 },
        assertions: [{ name: 'session succeeded', severity: 'gate', passed: false, message: 'no' }],
      }),
    ]);
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<failure');
  });
});
