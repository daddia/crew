import { DatabaseSync } from 'node:sqlite';

export type Step =
  | 'triage'
  | 'context-seed'
  | 'assess-clarification'
  | 'clarification-pending'
  | 'implement'
  | 'peer-code-review'
  | 'address-feedback'
  | 'open-mr'
  | 'ci-check'
  | 'in-qa'
  | 'ready-for-review'
  | 'needs-human-review';

export interface StoryRow {
  issueKey: string;
  currentStep: Step;
  startedAt: number;
}

export interface StepRow {
  issueKey: string;
  step: Step;
  sessionId: string | null;
  startedAt: number;
  finishedAt: number | null;
  costUsd: number | null;
  verdict: string | null;
}

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

export interface StateStore {
  upsertStory(issueKey: string, step: Step): void;
  getStory(issueKey: string): StoryRow | undefined;
  getStoriesAtStep(step: Step): StoryRow[];
  startStep(issueKey: string, step: Step, sessionId?: string): void;
  finishStep(
    issueKey: string,
    step: Step,
    result: { costUsd?: number; verdict?: string },
  ): void;
  getStepHistory(issueKey: string): StepRow[];
  countRefactorIterations(issueKey: string): number;
  /**
   * Returns `true` if (provider, eventId) has been seen before; records it if not.
   * Uses the same database connection as the state store — no second SQLite handle.
   */
  checkAndRecord(provider: string, eventId: string): boolean;
  /** Returns all steps that started an agent session but never finished. */
  getInterruptedSteps(): StepRow[];
  /**
   * Runs a lightweight `SELECT 1` probe. Throws if the database connection
   * is unavailable. Used by /healthz to surface DB health without exposing
   * the raw SQLite handle.
   */
  ping(): void;
  close(): void;
}

export function createStateStore(dbPath: string): StateStore {
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

  const countRefactorStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM steps
     WHERE issue_key = ? AND step = 'address-feedback'`,
  );

  const countEventStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM webhook_events WHERE provider = ? AND event_id = ?`,
  );

  const insertEventStmt = db.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES (?, ?, ?)`,
  );

  const getInterruptedStepsStmt = db.prepare(
    `SELECT issue_key as issueKey, step, session_id as sessionId,
            started_at as startedAt, finished_at as finishedAt,
            cost_usd as costUsd, verdict
     FROM steps WHERE finished_at IS NULL AND session_id IS NOT NULL
     ORDER BY started_at ASC`,
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

    finishStep(issueKey, step, { costUsd, verdict }) {
      finishStepStmt.run(Date.now(), costUsd ?? null, verdict ?? null, issueKey, step);
    },

    getStepHistory(issueKey) {
      return getStepHistoryStmt.all(issueKey) as unknown as StepRow[];
    },

    countRefactorIterations(issueKey) {
      const row = countRefactorStmt.get(issueKey) as { cnt: number };
      return row.cnt;
    },

    checkAndRecord(provider, eventId) {
      const existing = countEventStmt.get(provider, eventId) as { cnt: number };
      if (existing.cnt > 0) return true;
      insertEventStmt.run(provider, eventId, Date.now());
      return false;
    },

    getInterruptedSteps() {
      return getInterruptedStepsStmt.all() as unknown as StepRow[];
    },

    ping() {
      pingStmt.get();
    },

    close() {
      db.close();
    },
  };
}
