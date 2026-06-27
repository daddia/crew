import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../src/config.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import type { StateStore } from '../src/state.js';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@hono/node-server', () => ({
  serve: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock('../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state.js')>();
  return {
    ...actual,
    createStateStore: vi.fn().mockReturnValue({
      close: vi.fn(),
      getInterruptedSteps: vi.fn().mockReturnValue([]),
    }),
  };
});

vi.mock('../src/integrations/jira.js', () => ({
  createJiraClient: vi.fn().mockReturnValue({}),
}));

vi.mock('../src/integrations/gitlab.js', () => ({
  createGitlabClient: vi.fn().mockReturnValue({}),
}));

vi.mock('../src/workflow.js', () => ({
  recoverInterruptedSteps: vi.fn().mockResolvedValue(undefined),
  runReviewWorkflow: vi.fn(),
}));

vi.mock('../src/poller.js', () => ({
  startPoller: vi.fn().mockReturnValue(1),
}));

vi.mock('@daddia/crew', () => ({
  initTracing: vi.fn(),
}));

vi.mock('../src/observability.js', () => ({
  log: mockLog,
}));

import { boot, createApp } from '../src/index.js';
import { initTracing } from '@daddia/crew';
import { serve } from '@hono/node-server';
import { recoverInterruptedSteps } from '../src/workflow.js';
import { startPoller } from '../src/poller.js';
import { STEPS } from '../src/state.js';

const VALID_ENV: NodeJS.ProcessEnv = {
  CREW_ID: 'delivery-review-acme',
  ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@acme.example.com',
  JIRA_PROJECT_KEY: 'ACME',
  JIRA_ASSIGNEE_ACCOUNT_ID: '5b10ac8d82e05b22cc7d4ef5',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  PM_APPROVER_ACCOUNT_IDS: '5b10ac8d82e05b22cc7d4ef5',
  GITLAB_API_URL: 'https://gitlab.com/api/v4',
  GITLAB_PROJECT_ID: '12345678',
  DB_PATH: '/data/delivery-review.db',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-api-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-webhook-secret-ok',
};

const mockConfig = {
  identity: {
    crewId: 'delivery-review-acme',
    jira: {
      baseUrl: 'https://acme.atlassian.net',
      email: 'bot@acme.example.com',
      projectKey: 'ACME',
      assigneeAccountId: '5b10ac8d82e05b22cc7d4ef5',
      acceptanceCriteriaFieldId: 'customfield_10042',
      pmApproverAccountIds: ['5b10ac8d82e05b22cc7d4ef5'],
    },
    gitlab: {
      apiUrl: 'https://gitlab.com/api/v4',
      projectId: '12345678',
      defaultBranch: 'main',
    },
  },
  behaviour: {
    pollIntervalMs: 300_000,
    pmReviewTimeoutHours: 48,
    pmApprovalCommentPattern: '/pm-approve',
    techLeadMaxTurns: 30,
    techLeadCostCapUsd: 5,
    diffFileCap: 50,
    diffSizeCapBytes: 500_000,
    logLevel: 'info' as const,
    evalFixtureMode: 'mock' as const,
  },
  infrastructure: {
    port: 3002,
    dbPath: '/data/delivery-review.db',
  },
  secrets: {
    anthropicApiKey: 'sk-ant-key',
    atlassianApiToken: 'atlassian-api-token',
    gitlabAccessToken: 'glpat-token',
    jiraWebhookSecret: 'jira-webhook-secret-ok',
  },
} satisfies Config;

const mockState = {
  close: vi.fn(),
} as unknown as StateStore;

const mockCtxBase = {
  dbPath: mockConfig.infrastructure.dbPath,
  behaviour: mockConfig.behaviour,
  jira: {},
  gitlab: {},
} as unknown as WorkflowCtxBase;

describe('GET /healthz', () => {
  it('returns HTTP 200', async () => {
    const app = createApp(mockState, mockConfig, mockCtxBase);
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });

  it('returns JSON body with ok true', async () => {
    const app = createApp(mockState, mockConfig, mockCtxBase);
    const res = await app.request('/healthz');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('Step union', () => {
  it('enumerates all design-contract step members', () => {
    expect([...STEPS]).toEqual([
      'context-seed',
      'final-code-review',
      'stakeholder-review-pending',
      'merge-and-close',
      'done',
      'needs-human-review',
    ]);
  });
});

describe('boot – happy path', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('calls initTracing at boot with the crew service name', async () => {
    await boot(VALID_ENV);
    expect(initTracing).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'delivery-review' }),
    );
  });

  it('emits exactly one config.loaded log line', async () => {
    await boot(VALID_ENV);
    const calls = mockLog.info.mock.calls.filter((c) => c[0] === 'config.loaded');
    expect(calls).toHaveLength(1);
  });

  it('starts the HTTP server on the configured port', async () => {
    await boot({ ...VALID_ENV, PORT: '4001' });
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4001 }),
      expect.any(Function),
    );
  });

  it('runs startup recovery before the poller starts', async () => {
    await boot(VALID_ENV);
    const recoveryOrder = vi.mocked(recoverInterruptedSteps).mock.invocationCallOrder[0];
    const pollerOrder = vi.mocked(startPoller).mock.invocationCallOrder[0];
    expect(recoveryOrder).toBeLessThan(pollerOrder!);
  });

  it('starts the poller after boot', async () => {
    await boot(VALID_ENV);
    expect(startPoller).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          jira: expect.objectContaining({
            pmApproverAccountIds: ['5b10ac8d82e05b22cc7d4ef5'],
          }),
        }),
      }),
      expect.anything(),
    );
  });
});
