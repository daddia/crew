import { describe, it, expect } from 'vitest';
import { defineEval } from '../../src/evals/define-eval.js';

describe('defineEval', () => {
  it('returns the definition when valid', () => {
    const def = defineEval({
      name: 'smoke',
      async run() {},
    });
    expect(def.name).toBe('smoke');
  });

  it('requires a name', () => {
    expect(() => defineEval({ name: '  ', async run() {} })).toThrow(/name is required/);
  });
});
