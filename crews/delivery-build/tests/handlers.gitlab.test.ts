import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../src/workflow.js', () => ({
  addressFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/observability.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn((_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
      fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

import { gitlabHandler } from '../src/handlers/gitlab.js';
import { addressFeedback } from '../src/workflow.js';
import { inFlight } from '../src/in-flight.js';
import type { StateStore } from '../src/state.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const SECRET = 'gl-test-secret';

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
  behaviour: { refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 0, ciWaitTimeoutMs: 1_800_000, engineerMaxTurns: 50, engineerCompactionThreshold: 160_000, engineerCostCapUsd: 5, modelRouting: { lowCost: 'claude-sonnet-test', implementation: 'claude-opus-test' } },
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

function makeApp(state: StateStore): Hono {
  const app = new Hono();
  app.post('/webhooks/gitlab', (c) => gitlabHandler(c, state, SECRET, ctxBase));
  return app;
}

const notePayload = JSON.stringify({
  object_kind: 'note',
  object_attributes: { id: 1, note: 'Please fix the null check', system: false },
  merge_request: {
    title: '[ENG-99] Add login endpoint',
    url: 'https://gitlab.example.com/mr/1',
  },
});

describe('POST /webhooks/gitlab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inFlight.clear();
  });

  it('returns 403 when token is missing', async () => {
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: notePayload,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when token is wrong', async () => {
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: notePayload,
      headers: {
        'Content-Type': 'application/json',
        'x-gitlab-token': 'wrong',
      },
    });
    expect(res.status).toBe(403);
  });

  it('dispatches addressFeedback for a human MR comment', async () => {
    const state = makeState();
    const app = makeApp(state);
    const res = await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: notePayload,
      headers: {
        'Content-Type': 'application/json',
        'x-gitlab-token': SECRET,
        'x-gitlab-event-uuid': 'evt-001',
      },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(addressFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'ENG-99' }),
      'Please fix the null check',
      'https://gitlab.example.com/mr/1',
    );
  });

  it('ignores system-generated notes', async () => {
    const systemPayload = JSON.stringify({
      object_kind: 'note',
      object_attributes: { id: 2, note: 'approved this merge request', system: true },
      merge_request: {
        title: '[ENG-99] Add login endpoint',
        url: 'https://gitlab.example.com/mr/1',
      },
    });
    const state = makeState();
    const app = makeApp(state);
    await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: systemPayload,
      headers: {
        'Content-Type': 'application/json',
        'x-gitlab-token': SECRET,
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(addressFeedback).not.toHaveBeenCalled();
  });

  it('returns 429 when the issueKey is already in flight', async () => {
    inFlight.add('ENG-99');
    const app = makeApp(makeState());
    const res = await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: notePayload,
      headers: {
        'Content-Type': 'application/json',
        'x-gitlab-token': SECRET,
        'x-gitlab-event-uuid': 'evt-002',
      },
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['error']).toBe('workflow-in-flight');
    expect(json['issueKey']).toBe('ENG-99');
    await new Promise((r) => setImmediate(r));
    expect(addressFeedback).not.toHaveBeenCalled();
  });

  it('acquires the lock before dispatch and releases it after workflow completes', async () => {
    let resolveWorkflow!: () => void;
    const workflowPromise = new Promise<void>((resolve) => {
      resolveWorkflow = resolve;
    });
    vi.mocked(addressFeedback).mockReturnValueOnce(workflowPromise);

    const app = makeApp(makeState());
    await app.request('/webhooks/gitlab', {
      method: 'POST',
      body: notePayload,
      headers: {
        'Content-Type': 'application/json',
        'x-gitlab-token': SECRET,
        'x-gitlab-event-uuid': 'evt-003',
      },
    });

    // Lock must be held immediately after the handler returns.
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
