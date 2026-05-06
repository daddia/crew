import { createIdempotencyStore } from "@daddia/crew/webhooks";

type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

let store: IdempotencyStore | undefined;

// Lazy singleton so module import does not eagerly open SQLite — tests can
// inject DB_PATH (or mock the underlying factory) before the first request.
export function getIdempotency(): IdempotencyStore {
  if (!store) {
    const dbPath = process.env["DB_PATH"] ?? "./data/delivery-build.db";
    store = createIdempotencyStore(dbPath);
  }
  return store;
}
