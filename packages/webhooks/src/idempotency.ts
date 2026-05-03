import { DatabaseSync } from "node:sqlite";
import type { Provider } from "./verify.js";

export interface IdempotencyStore {
  /**
   * Returns `true` if this (provider, eventId) pair has been seen before.
   * Records the pair if it has not.
   */
  checkAndRecord(provider: Provider, eventId: string): boolean;
  close(): void;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS webhook_events (
    provider    TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (provider, event_id)
  )
`;

export function createIdempotencyStore(dbPath: string): IdempotencyStore {
  const db = new DatabaseSync(dbPath);
  db.exec(CREATE_TABLE);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES (?, ?, ?)`,
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM webhook_events WHERE provider = ? AND event_id = ?`,
  );

  return {
    checkAndRecord(provider, eventId) {
      const existing = countStmt.get(provider, eventId) as { cnt: number };
      if (existing.cnt > 0) return true;
      insertStmt.run(provider, eventId, Date.now());
      return false;
    },
    close() {
      db.close();
    },
  };
}
