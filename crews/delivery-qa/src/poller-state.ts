/**
 * In-memory poller health state. Updated after every poll interval so the
 * /healthz endpoint can surface it without querying any external system.
 *
 * Module-level variables are intentional: there is exactly one poller per
 * process and the values are small scalars. Tests reset them by importing and
 * overwriting, or by mocking this module.
 */
export let lastTickAt: number | null = null;
export let lastTickStatus: 'ok' | 'error' | null = null;

export function recordTick(status: 'ok' | 'error'): void {
  lastTickAt = Date.now();
  lastTickStatus = status;
}
