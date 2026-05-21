import { createHmac, timingSafeEqual } from 'node:crypto';

export type Provider = 'jira' | 'gitlab';

/**
 * Verify the HMAC signature on an incoming webhook request.
 *
 * Jira:   `X-Hub-Signature: sha256=<hex>`
 * GitLab: `X-Gitlab-Token: <plain secret>` (GitLab uses a shared token, not HMAC)
 */
export function verifySignature(
  provider: Provider,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): void {
  switch (provider) {
    case 'jira':
      verifyJira(rawBody, headers, secret);
      break;
    case 'gitlab':
      verifyGitLab(headers, secret);
      break;
  }
}

function verifyJira(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): void {
  const header = singleHeader(headers, 'x-hub-signature-256');
  if (!header) {
    throw new SignatureError('Missing X-Hub-Signature-256 header');
  }
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) {
    throw new SignatureError('Unexpected signature format');
  }
  const expected = Buffer.from(header.slice(prefix.length), 'hex');
  const actual = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SignatureError('Signature mismatch');
  }
}

function verifyGitLab(
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): void {
  const token = singleHeader(headers, 'x-gitlab-token');
  if (!token) {
    throw new SignatureError('Missing X-Gitlab-Token header');
  }
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SignatureError('Token mismatch');
  }
}

function singleHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name];
  if (Array.isArray(val)) return val[0];
  return val;
}

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}
