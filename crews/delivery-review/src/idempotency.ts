import { createIdempotencyStore } from '@daddia/crew/webhooks';
import type { IdempotencyStore } from '@daddia/crew/webhooks';

let store: IdempotencyStore | undefined;

/**
 * Lazy singleton for webhook deduplication. Handlers obtain the store via this
 * accessor so the SQLite path is resolved once at first use.
 */
export function getIdempotencyStore(dbPath: string): IdempotencyStore {
  if (!store) {
    store = createIdempotencyStore(dbPath);
  }
  return store;
}
