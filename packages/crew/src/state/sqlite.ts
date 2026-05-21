import { DatabaseSync } from 'node:sqlite';
import type { StateStore, StoryRow, StepRow, StepResult } from './store.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS stories (
    issue_key     TEXT PRIMARY KEY,
    current_step  TEXT NOT NULL,
    started_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key   TEXT NOT NULL,
    step        TEXT NOT NULL,
    session_id  TEXT,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    cost_usd    REAL,
    verdict     TEXT
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    provider    TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (provider, event_id)
  );
`;

export function createSqliteStateStore(dbPath: string): StateStore {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const upsertStoryStmt = db.prepare(
    `INSERT INTO stories (issue_key, current_step, started_at)
     VALUES (?, ?, ?)
     ON CONFLICT(issue_key) DO UPDATE SET current_step = excluded.current_step`,
  );

  const getStoryStmt = db.prepare(
    `SELECT issue_key as issueKey, current_step as currentStep, started_at as startedAt
     FROM stories WHERE issue_key = ?`,
  );

  const getStoriesAtStepStmt = db.prepare(
    `SELECT issue_key as issueKey, current_step as currentStep, started_at as startedAt
     FROM stories WHERE current_step = ?`,
  );

  const startStepStmt = db.prepare(
    `INSERT INTO steps (issue_key, step, session_id, started_at)
     VALUES (?, ?, ?, ?)`,
  );

  const finishStepStmt = db.prepare(
    `UPDATE steps
     SET finished_at = ?, cost_usd = ?, verdict = ?
     WHERE issue_key = ? AND step = ? AND finished_at IS NULL`,
  );

  const getStepHistoryStmt = db.prepare(
    `SELECT issue_key as issueKey, step, session_id as sessionId,
            started_at as startedAt, finished_at as finishedAt,
            cost_usd as costUsd, verdict
     FROM steps WHERE issue_key = ? ORDER BY started_at ASC`,
  );

  const countStepOccurrencesStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM steps WHERE issue_key = ? AND step = ?`,
  );

  const getInterruptedStepsStmt = db.prepare(
    `SELECT issue_key as issueKey, step, session_id as sessionId,
            started_at as startedAt, finished_at as finishedAt,
            cost_usd as costUsd, verdict
     FROM steps WHERE finished_at IS NULL AND session_id IS NOT NULL
     ORDER BY started_at ASC`,
  );

  const checkEventStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM webhook_events WHERE provider = ? AND event_id = ?`,
  );

  const insertEventStmt = db.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES (?, ?, ?)`,
  );

  const pingStmt = db.prepare('SELECT 1');

  return {
    upsertStory(issueKey, step) {
      upsertStoryStmt.run(issueKey, step, Date.now());
    },

    getStory(issueKey) {
      return getStoryStmt.get(issueKey) as StoryRow | undefined;
    },

    getStoriesAtStep(step) {
      return getStoriesAtStepStmt.all(step) as unknown as StoryRow[];
    },

    startStep(issueKey, step, sessionId) {
      startStepStmt.run(issueKey, step, sessionId ?? null, Date.now());
    },

    finishStep(issueKey, step, { costUsd, verdict }: StepResult) {
      finishStepStmt.run(Date.now(), costUsd ?? null, verdict ?? null, issueKey, step);
    },

    getStepHistory(issueKey) {
      return getStepHistoryStmt.all(issueKey) as unknown as StepRow[];
    },

    countStepOccurrences(issueKey, step) {
      const row = countStepOccurrencesStmt.get(issueKey, step) as { cnt: number };
      return row.cnt;
    },

    getInterruptedSteps() {
      return getInterruptedStepsStmt.all() as unknown as StepRow[];
    },

    checkAndRecord(provider, eventId) {
      const existing = checkEventStmt.get(provider, eventId) as { cnt: number };
      if (existing.cnt > 0) return true;
      insertEventStmt.run(provider, eventId, Date.now());
      return false;
    },

    ping() {
      pingStmt.get();
    },

    close() {
      db.close();
    },
  };
}
