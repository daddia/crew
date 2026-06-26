import { describe, it, expect } from 'vitest';
import { createApp } from '../src/index.js';
import { STEPS } from '../src/state.js';

describe('GET /healthz', () => {
  it('returns HTTP 200', async () => {
    const app = createApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });

  it('returns JSON body with ok true', async () => {
    const app = createApp();
    const res = await app.request('/healthz');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('Step union', () => {
  it('enumerates all design-contract step members', () => {
    expect([...STEPS]).toEqual([
      'context-seed',
      'final-code-review',
      'stakeholder-review-pending',
      'merge-and-close',
      'done',
      'needs-human-review',
    ]);
  });
});
