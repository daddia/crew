import { afterEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as crew from '@daddia/crew';
import {
  checkReplayWindow,
  createIdempotencyStore,
  ReplayError,
  SignatureError,
  verifySignature,
} from '@daddia/crew/webhooks';

let dbPath: string | undefined;

afterEach(() => {
  if (dbPath && existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
  dbPath = undefined;
});

describe('@daddia/crew/webhooks', () => {
  it('exports verify, replay, and idempotency APIs', () => {
    expect(typeof verifySignature).toBe('function');
    expect(typeof checkReplayWindow).toBe('function');
    expect(typeof createIdempotencyStore).toBe('function');
    expect(new SignatureError('x').name).toBe('SignatureError');
    expect(new ReplayError('x').name).toBe('ReplayError');
  });

  it('GitLab verify rejects missing token header', () => {
    expect(() => verifySignature('gitlab', Buffer.from('{}'), {}, 'secret')).toThrow(
      SignatureError,
    );
  });

  it('GitLab verify accepts matching token', () => {
    expect(() =>
      verifySignature('gitlab', Buffer.from('{}'), { 'x-gitlab-token': 'secret' }, 'secret'),
    ).not.toThrow();
  });

  it('Jira verify accepts valid HMAC body signature', () => {
    const secret = 'webhook-secret';
    const body = Buffer.from('{"hello":"world"}');
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    expect(() =>
      verifySignature('jira', body, { 'x-hub-signature-256': `sha256=${hex}` }, secret),
    ).not.toThrow();
  });

  it('checkReplayWindow throws when timestamp is outside window', () => {
    const ancient = Date.now() - 24 * 60 * 60 * 1000;
    expect(() => checkReplayWindow({ timestampMs: ancient, windowMs: 60_000 })).toThrow(
      ReplayError,
    );
  });

  it('createIdempotencyStore deduplicates by provider and event id', () => {
    dbPath = join(tmpdir(), `crew-webhook-test-${randomBytes(8).toString('hex')}.db`);
    const store = createIdempotencyStore(dbPath);
    expect(store.checkAndRecord('jira', 'evt-1')).toBe(false);
    expect(store.checkAndRecord('jira', 'evt-1')).toBe(true);
    store.close();
  });
});

describe('@daddia/crew main entry', () => {
  it('does not expose webhook helpers on the core barrel', () => {
    expect(crew as Record<string, unknown>).not.toHaveProperty('verifySignature');
    expect(crew as Record<string, unknown>).not.toHaveProperty('createIdempotencyStore');
  });
});
