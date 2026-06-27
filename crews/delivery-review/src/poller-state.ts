/**
 * In-memory poller health state. Updated after every poll interval so the
 * /healthz endpoint can surface it without querying any external system.
 */
export let lastTickAt: number | null = null;
export let lastTickStatus: 'ok' | 'error' | null = null;

export function recordTick(status: 'ok' | 'error'): void {
  lastTickAt = Date.now();
  lastTickStatus = status;
}
