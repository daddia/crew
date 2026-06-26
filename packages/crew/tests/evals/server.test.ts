import { describe, it, expect } from 'vitest';
import { createEvalFetchHandler } from '../../src/evals/server.js';

describe('createEvalFetchHandler', () => {
  const handler = createEvalFetchHandler({
    fixtures: {
      smoke: async () => ({
        success: true,
        summary: 'smoke ok',
        artefacts: {},
        costUsd: 0,
      }),
      failure: async () => ({
        success: false,
        summary: 'failed',
        artefacts: {},
        costUsd: 0,
      }),
    },
  });

  it('lists fixtures on GET /eval/health', async () => {
    const res = await handler(new Request('http://localhost/eval/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fixtures: string[] };
    expect(body.fixtures).toEqual(expect.arrayContaining(['smoke', 'failure']));
  });

  it('runs a fixture on POST /eval/session', async () => {
    const res = await handler(
      new Request('http://localhost/eval/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: 'smoke' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns 404 for unknown fixture', async () => {
    const res = await handler(
      new Request('http://localhost/eval/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: 'missing' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
