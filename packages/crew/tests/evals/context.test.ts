import { describe, it, expect } from 'vitest';
import { createEvalContext, evalPassed } from '../../src/evals/context.js';

describe('createEvalContext', () => {
  it('records gate failure when session.success is false', () => {
    const ctx = createEvalContext({
      success: false,
      summary: 'agent failed',
      artefacts: {},
      costUsd: 0,
    });
    ctx.succeeded();
    expect(ctx.assertions).toHaveLength(1);
    expect(ctx.assertions[0]).toMatchObject({ passed: false, severity: 'gate' });
    expect(evalPassed(ctx.assertions, false)).toBe(false);
  });

  it('passes gate when session succeeded', () => {
    const ctx = createEvalContext({
      success: true,
      summary: 'ok',
      artefacts: {},
      costUsd: 0,
    });
    ctx.succeeded();
    expect(evalPassed(ctx.assertions, false)).toBe(true);
  });

  it('treats soft failures as pass unless strict', () => {
    const ctx = createEvalContext({
      success: true,
      summary: 'ok',
      artefacts: {},
      costUsd: 0,
    });
    ctx.soft.expect(false, 'optional check');
    expect(evalPassed(ctx.assertions, false)).toBe(true);
    expect(evalPassed(ctx.assertions, true)).toBe(false);
  });
});
