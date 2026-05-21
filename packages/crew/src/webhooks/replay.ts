/**
 * Timestamp-window replay defence.
 *
 * Rejects requests whose timestamp is outside the allowed window.
 * Callers should pair this with the nonce/idempotency check in idempotency.ts
 * to prevent replayed requests within the window.
 */

export interface ReplayCheckOptions {
  /** The timestamp parsed from the webhook header (milliseconds since epoch). */
  timestampMs: number;
  /** Allowed drift window in milliseconds. Defaults to 5 minutes. */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export function checkReplayWindow(options: ReplayCheckOptions): void {
  const { timestampMs, windowMs = DEFAULT_WINDOW_MS } = options;
  const now = Date.now();
  const delta = Math.abs(now - timestampMs);
  if (delta > windowMs) {
    throw new ReplayError(`Request timestamp is ${delta}ms outside the ${windowMs}ms window`);
  }
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}
