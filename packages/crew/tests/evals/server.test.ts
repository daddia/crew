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

  it('lists fixtures on GET /eval/ (eval mount root)', async () => {
    const res = await handler(new Request('http://localhost/eval/'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; fixtures: string[] };
    expect(body.ok).toBe(true);
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

  it('returns a generic error when a fixture throws', async () => {
    const throwingHandler = createEvalFetchHandler({
      fixtures: {
        throws: async () => {
          throw new Error('internal stack trace at /secret/path.ts:42');
        },
      },
    });

    const res = await throwingHandler(
      new Request('http://localhost/eval/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: 'throws' }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Eval session failed');
  });
});
