import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';

vi.mock('../src/workflow.js', () => ({
  runStory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/observability.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn((_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
      fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

import { jiraHandler } from '../src/handlers/jira.js';
import { runStory } from '../src/workflow.js';
import { inFlight } from '../src/in-flight.js';
import type { StateStore } from '../src/state.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const SECRET = 'test-secret';

const mockJira = {
  transitionIssue: vi.fn(),
  getIssue: vi.fn(),
  commentOnIssue: vi.fn(),
  getComments: vi.fn(),
  searchIssues: vi.fn(),
} satisfies JiraClient;

const mockGitlab = {
  createMr: vi.fn(),
  getPipelineStatus: vi.fn(),
  getMrDiff: vi.fn(),
  postReviewComment: vi.fn(),
} satisfies GitlabClient;

const ctxBase: WorkflowCtxBase = {
  behaviour: { refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 0, ciWaitTimeoutMs: 1_800_000, engineerMaxTurns: 50, engineerCostCapUsd: 5 },
  jira: mockJira,
  gitlab: mockGitlab,
  projectDir: '/project',
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
  transition: { transitionName: 'Ready for Dev' },
  issue: { key: 'ENG-99' },
});

describe('POST /webhooks/jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inFlight.clear();
  });

  it('returns 403 when signature is missing', async () => {
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when signature is wrong', async () => {
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
  });

  it('dispatches runStory for Ready for Dev transition', async () => {
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
    expect(runStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'ENG-99' }));
  });

  it('ignores non-Ready-for-Dev transitions', async () => {
    const body = JSON.stringify({
      id: 43,
      timestamp: Date.now(),
      transition: { transitionName: 'In Progress' },
      issue: { key: 'ENG-99' },
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

  it('returns 429 when the issueKey is already in flight', async () => {
    inFlight.add('ENG-99');
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(validPayload),
      },
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['error']).toBe('workflow-in-flight');
    expect(json['issueKey']).toBe('ENG-99');
    await new Promise((r) => setImmediate(r));
    expect(runStory).not.toHaveBeenCalled();
  });

  it('acquires the lock before dispatch and releases it after workflow completes', async () => {
    let resolveWorkflow!: () => void;
    const workflowPromise = new Promise<void>((resolve) => {
      resolveWorkflow = resolve;
    });
    vi.mocked(runStory).mockReturnValueOnce(workflowPromise);

    const app = makeApp(makeState());
    await app.request('/webhooks/jira', {
      method: 'POST',
      body: validPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(validPayload),
      },
    });

    // Lock must be held immediately after the handler returns (before setImmediate fires).
    expect(inFlight.has('ENG-99')).toBe(true);

    await new Promise((r) => setImmediate(r));
    // Still held while the workflow promise is pending.
    expect(inFlight.has('ENG-99')).toBe(true);

    resolveWorkflow();
    await workflowPromise;
    await new Promise((r) => setImmediate(r));
    // Released once the workflow settles.
    expect(inFlight.has('ENG-99')).toBe(false);
  });
});
