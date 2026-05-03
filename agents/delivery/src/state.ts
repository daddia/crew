import { DatabaseSync } from "node:sqlite";

export type Phase =
  | "triage"
  | "implement"
  | "open-mr"
  | "peer-code-review"
  | "address-feedback"
  | "final-code-review"
  | "stakeholder-review"
  | "done"
  | "needs-human-review";

export interface StoryRow {
  issueKey: string;
  currentPhase: Phase;
  startedAt: number;
}

export interface PhaseRow {
  issueKey: string;
  phase: Phase;
  sessionId: string | null;
  startedAt: number;
  finishedAt: number | null;
  costUsd: number | null;
  verdict: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS stories (
    issue_key     TEXT PRIMARY KEY,
    current_phase TEXT NOT NULL,
    started_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS phases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key   TEXT NOT NULL,
    phase       TEXT NOT NULL,
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
  upsertStory(issueKey: string, phase: Phase): void;
  getStory(issueKey: string): StoryRow | undefined;
  startPhase(issueKey: string, phase: Phase, sessionId?: string): void;
  finishPhase(
    issueKey: string,
    phase: Phase,
    result: { costUsd?: number; verdict?: string },
  ): void;
  getPhaseHistory(issueKey: string): PhaseRow[];
  countRefactorIterations(issueKey: string): number;
  close(): void;
}

export function createStateStore(dbPath: string): StateStore {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const upsertStoryStmt = db.prepare(
    `INSERT INTO stories (issue_key, current_phase, started_at)
     VALUES (?, ?, ?)
     ON CONFLICT(issue_key) DO UPDATE SET current_phase = excluded.current_phase`,
  );

  const getStoryStmt = db.prepare(
    `SELECT issue_key as issueKey, current_phase as currentPhase, started_at as startedAt
     FROM stories WHERE issue_key = ?`,
  );

  const startPhaseStmt = db.prepare(
    `INSERT INTO phases (issue_key, phase, session_id, started_at)
     VALUES (?, ?, ?, ?)`,
  );

  const finishPhaseStmt = db.prepare(
    `UPDATE phases
     SET finished_at = ?, cost_usd = ?, verdict = ?
     WHERE id = (
       SELECT id FROM phases
       WHERE issue_key = ? AND finished_at IS NULL
       ORDER BY started_at DESC LIMIT 1
     )`,
  );

  const getPhaseHistoryStmt = db.prepare(
    `SELECT issue_key as issueKey, phase, session_id as sessionId,
            started_at as startedAt, finished_at as finishedAt,
            cost_usd as costUsd, verdict
     FROM phases WHERE issue_key = ? ORDER BY started_at ASC`,
  );

  const countRefactorStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM phases
     WHERE issue_key = ? AND phase = 'address-feedback'`,
  );

  return {
    upsertStory(issueKey, phase) {
      upsertStoryStmt.run(issueKey, phase, Date.now());
    },

    getStory(issueKey) {
      return getStoryStmt.get(issueKey) as StoryRow | undefined;
    },

    startPhase(issueKey, phase, sessionId) {
      startPhaseStmt.run(issueKey, phase, sessionId ?? null, Date.now());
    },

    finishPhase(issueKey, phase, { costUsd, verdict }) {
      finishPhaseStmt.run(Date.now(), costUsd ?? null, verdict ?? null, issueKey);
      void phase;
    },

    getPhaseHistory(issueKey) {
      return getPhaseHistoryStmt.all(issueKey) as unknown as PhaseRow[];
    },

    countRefactorIterations(issueKey) {
      const row = countRefactorStmt.get(issueKey) as { cnt: number };
      return row.cnt;
    },

    close() {
      db.close();
    },
  };
}
