import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/index.js';
import type { Config } from '../src/config.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import type { StateStore } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockJira = {
  transitionIssue: vi.fn(),
  getIssue: vi.fn(),
  commentOnIssue: vi.fn(),
  addLabel: vi.fn(),
  getComments: vi.fn(),
  searchIssues: vi.fn(),
} satisfies JiraClient;

const mockGitlab = {
  getPipelineStatus: vi.fn(),
  getMrSourceBranch: vi.fn(),
  findOpenMrForIssue: vi.fn(),
} satisfies GitlabClient;

const ctxBase: WorkflowCtxBase = {
  behaviour: {
    qaDefectLoopCap: 2,
    remediationTimeoutHours: 48,
    externalIntegrationMode: 'mock',
    automatedTestCommand: 'pnpm test',
    qaEngineerMaxTurns: 40,
    qaEngineerCostCapUsd: 4,
  },
  jira: mockJira,
  gitlab: mockGitlab,
  qaWorkspaceDir: '/workspace/qa',
};

const mockConfig = {
  secrets: { jiraWebhookSecret: 'jira-webhook-secret-ok' },
} as Config;

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

describe('GET /healthz', () => {
  it('returns HTTP 200', async () => {
    const app = createApp(makeState(), mockConfig, ctxBase);
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });

  it('returns JSON body with ok true', async () => {
    const app = createApp(makeState(), mockConfig, ctxBase);
    const res = await app.request('/healthz');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
