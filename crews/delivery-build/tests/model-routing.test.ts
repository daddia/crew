import { describe, it, expect } from 'vitest';
import { resolveModelForTask } from '../src/model-routing.js';

const ROUTING = {
  lowCost: 'claude-sonnet-test',
  implementation: 'claude-opus-test',
};

describe('resolveModelForTask', () => {
  it('routes assess-clarification to the low-cost model', () => {
    expect(resolveModelForTask(ROUTING, 'assess-clarification')).toBe('claude-sonnet-test');
  });

  it('routes peer-code-review to the low-cost model', () => {
    expect(resolveModelForTask(ROUTING, 'peer-code-review')).toBe('claude-sonnet-test');
  });

  it('routes implement-story to the implementation model', () => {
    expect(resolveModelForTask(ROUTING, 'implement-story')).toBe('claude-opus-test');
  });

  it('routes address-feedback to the implementation model', () => {
    expect(resolveModelForTask(ROUTING, 'address-feedback')).toBe('claude-opus-test');
  });

  it('routes fix-ci to the implementation model', () => {
    expect(resolveModelForTask(ROUTING, 'fix-ci')).toBe('claude-opus-test');
  });
});
