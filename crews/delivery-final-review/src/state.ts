import { DatabaseSync } from 'node:sqlite';

export type Step = 'final-code-review' | 'stakeholder-review' | 'done' | 'needs-human-review';

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

  -- Populated by createIdempotencyStore() from @daddia/crew/webhooks.
  -- Required by every inbound webhook handler for deduplication; included
  -- here so the schema is complete when handlers are wired.
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
  startStep(issueKey: string, step: Step, sessionId?: string): void;
  finishStep(issueKey: string, step: Step, result: { costUsd?: number; verdict?: string }): void;
  getStepHistory(issueKey: string): StepRow[];
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

  const startStepStmt = db.prepare(
    `INSERT INTO steps (issue_key, step, session_id, started_at)
     VALUES (?, ?, ?, ?)`,
  );

  const finishStepStmt = db.prepare(
    `UPDATE steps
     SET finished_at = ?, cost_usd = ?, verdict = ?
     WHERE id = (
       SELECT id FROM steps
       WHERE issue_key = ? AND step = ? AND finished_at IS NULL
       ORDER BY started_at DESC LIMIT 1
     )`,
  );

  const getStepHistoryStmt = db.prepare(
    `SELECT issue_key as issueKey, step, session_id as sessionId,
            started_at as startedAt, finished_at as finishedAt,
            cost_usd as costUsd, verdict
     FROM steps WHERE issue_key = ? ORDER BY started_at ASC`,
  );

  return {
    upsertStory(issueKey, step) {
      upsertStoryStmt.run(issueKey, step, Date.now());
    },

    getStory(issueKey) {
      return getStoryStmt.get(issueKey) as StoryRow | undefined;
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

    close() {
      db.close();
    },
  };
}
