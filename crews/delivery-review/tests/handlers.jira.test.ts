import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';

vi.mock('../src/workflow.js', () => ({
  runReviewWorkflow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/observability.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn(
      (_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
        fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

import { jiraHandler } from '../src/handlers/jira.js';
import { runReviewWorkflow } from '../src/workflow.js';
import { inFlight } from '../src/in-flight.js';
import type { StateStore } from '../src/state.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const SECRET = 'test-secret-16chars';

const mockJira = {
  transitionIssue: vi.fn(),
  getIssue: vi.fn(),
  getIssueStatus: vi.fn(),
  commentOnIssue: vi.fn(),
  getComments: vi.fn(),
  searchIssues: vi.fn(),
} satisfies JiraClient;

const mockGitlab = {
  getPipelineStatus: vi.fn(),
  getMrSourceBranch: vi.fn(),
  findOpenMrForIssue: vi.fn(),
  findMrForIssue: vi.fn(),
  getMrDiff: vi.fn(),
  approveMergeRequest: vi.fn(),
  mergeMergeRequest: vi.fn(),
} satisfies GitlabClient;

const ctxBase: WorkflowCtxBase = {
  behaviour: {
    pmReviewTimeoutHours: 48,
    pmApprovalCommentPattern: '/pm-approve',
    techLeadMaxTurns: 30,
    techLeadCostCapUsd: 5,
    diffFileCap: 50,
    diffSizeCapBytes: 500_000,
  },
  jira: mockJira,
  gitlab: mockGitlab,
};

function makeState(): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function signBody(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeApp(state: StateStore): Hono {
  const app = new Hono();
  app.post('/webhooks/jira', (c) => jiraHandler(c, state, SECRET, ctxBase));
  return app;
}

const validPayload = JSON.stringify({
  id: 42,
  timestamp: Date.now(),
  transition: { transitionName: 'In Review' },
  issue: { key: 'CREW-99' },
});

describe('POST /webhooks/jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inFlight.clear();
  });

  it('returns 403 when signature is invalid', async () => {
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
    });
    expect(res.status).toBe(403);
    expect(runReviewWorkflow).not.toHaveBeenCalled();
  });

  it('dispatches runReviewWorkflow for In Review transition', async () => {
    const state = makeState();
    const app = makeApp(state);
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(validPayload),
      },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(runReviewWorkflow).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'CREW-99' }));
  });

  it('returns 200 with duplicate true for a replayed event id', async () => {
    const state = makeState();
    vi.mocked(state.checkAndRecord).mockReturnValue(true);
    const app = makeApp(state);
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(validPayload),
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['duplicate']).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(runReviewWorkflow).not.toHaveBeenCalled();
  });

  it('ignores non-In-Review transitions', async () => {
    const body = JSON.stringify({
      id: 43,
      timestamp: Date.now(),
      transition: { transitionName: 'In Progress' },
      issue: { key: 'CREW-99' },
    });
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(body),
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['ignored']).toBe(true);
  });
});
