import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@hono/node-server', () => ({
  serve: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock('../src/state.js', () => ({
  createStateStore: vi.fn().mockReturnValue({
    close: vi.fn(),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock('../src/integrations/jira.js', () => ({
  createJiraClient: vi.fn().mockReturnValue({
    transitionIssue: vi.fn(),
    getIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    getComments: vi.fn(),
    searchIssues: vi.fn(),
  }),
}));

vi.mock('../src/integrations/gitlab.js', () => ({
  createGitlabClient: vi.fn().mockReturnValue({
    createMr: vi.fn(),
    getPipelineStatus: vi.fn(),
    getMrDiff: vi.fn(),
    postReviewComment: vi.fn(),
  }),
}));

vi.mock('../src/poller.js', () => ({
  startPoller: vi.fn(),
}));

vi.mock('../src/workflow.js', () => ({
  recoverInterruptedSteps: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return { ...actual, loadConfig: vi.fn(actual.loadConfig) };
});

vi.mock('../src/run-stream-hub.js', () => ({
  runStreamHub: {
    publish: vi.fn(),
    subscribe: vi.fn(),
    closeIssue: vi.fn(),
  },
  publishRunStep: vi.fn(),
}));

vi.mock('@daddia/crew', () => ({
  initTracing: vi.fn(),
}));

vi.mock('../src/observability.js', () => ({
  log: mockLog,
}));

import { boot } from '../src/index.js';
import { initTracing } from '@daddia/crew';
import { serve } from '@hono/node-server';
import { loadConfig } from '../src/config.js';
import { ConfigNotFoundError } from '@daddia/crew/config';

const VALID_ENV: NodeJS.ProcessEnv = {
  CREW_ID: 'delivery-build-acme',
  ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@acme.example.com',
  JIRA_PROJECT_KEY: 'ACME',
  JIRA_ASSIGNEE_ACCOUNT_ID: '5b10ac8d82e05b22cc7d4ef5',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  GITLAB_API_URL: 'https://gitlab.com/api/v4',
  GITLAB_PROJECT_ID: '12345678',
  DB_PATH: '/data/delivery-build.db',
  PROJECT_DIR: '/workspace/acme',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-api-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-webhook-secret-ok',
  GITLAB_WEBHOOK_SECRET: 'gitlab-webhook-secret-ok',
};

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
      expect.objectContaining({ serviceName: 'delivery-build' }),
    );
  });

  it('emits exactly one config.loaded log line', async () => {
    await boot(VALID_ENV);
    const calls = mockLog.info.mock.calls.filter((c) => c[0] === 'config.loaded');
    expect(calls).toHaveLength(1);
  });

  it('config.loaded payload contains crewId and schemaVersion', async () => {
    await boot(VALID_ENV);
    const match = mockLog.info.mock.calls.find((c) => c[0] === 'config.loaded');
    expect(match).toBeDefined();
    const [, payload] = match!;
    expect(payload).toMatchObject({ crewId: 'delivery-build-acme', schemaVersion: 1 });
  });

  it('config.loaded payload does not contain any of the five secret values', async () => {
    await boot(VALID_ENV);
    const match = mockLog.info.mock.calls.find((c) => c[0] === 'config.loaded');
    const [, payload] = match!;
    const str = JSON.stringify(payload);
    for (const secret of [
      'sk-ant-key',
      'atlassian-api-token',
      'glpat-token',
      'jira-webhook-secret-ok',
      'gitlab-webhook-secret-ok',
    ]) {
      expect(str).not.toContain(secret);
    }
  });

  it('resolves gitSha from RAILWAY_GIT_COMMIT_SHA first', async () => {
    await boot({ ...VALID_ENV, RAILWAY_GIT_COMMIT_SHA: 'sha-railway-001', GIT_SHA: 'sha-git-001' });
    const [, payload] = mockLog.info.mock.calls.find((c) => c[0] === 'config.loaded')!;
    expect(payload).toMatchObject({ gitSha: 'sha-railway-001' });
  });

  it('falls back to GIT_SHA when RAILWAY_GIT_COMMIT_SHA is absent', async () => {
    await boot({ ...VALID_ENV, GIT_SHA: 'sha-git-002' });
    const [, payload] = mockLog.info.mock.calls.find((c) => c[0] === 'config.loaded')!;
    expect(payload).toMatchObject({ gitSha: 'sha-git-002' });
  });

  it("defaults gitSha to 'unknown' when neither SHA env var is set", async () => {
    await boot(VALID_ENV);
    const [, payload] = mockLog.info.mock.calls.find((c) => c[0] === 'config.loaded')!;
    expect(payload).toMatchObject({ gitSha: 'unknown' });
  });

  it('does not call process.exit on valid config', async () => {
    await boot(VALID_ENV);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('binds the HTTP server on the configured port', async () => {
    await boot(VALID_ENV);
    expect(vi.mocked(serve)).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
      expect.any(Function),
    );
  });
});

describe('boot – misconfig path', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('emits config.invalid when a required env var is missing', async () => {
    const env = { ...VALID_ENV };
    delete env.JIRA_PROJECT_KEY;

    await boot(env);

    const calls = mockLog.error.mock.calls.filter((c) => c[0] === 'config.invalid');
    expect(calls).toHaveLength(1);
  });

  it('config.invalid issues array contains the failing field path', async () => {
    const env = { ...VALID_ENV };
    delete env.JIRA_PROJECT_KEY;

    await boot(env);

    const [, payload] = mockLog.error.mock.calls.find((c) => c[0] === 'config.invalid')!;
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('projectKey') }),
      ]),
    );
  });

  it('exits with code 1 on SchemaValidationError', async () => {
    const env = { ...VALID_ENV };
    delete env.JIRA_PROJECT_KEY;

    await boot(env);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not emit config.loaded on misconfig', async () => {
    const env = { ...VALID_ENV };
    delete env.JIRA_PROJECT_KEY;

    await boot(env);

    expect(mockLog.info.mock.calls.filter((c) => c[0] === 'config.loaded')).toHaveLength(0);
  });

  it('does not bind the HTTP server before exit on misconfig', async () => {
    const env = { ...VALID_ENV };
    delete env.JIRA_PROJECT_KEY;

    await boot(env);

    expect(vi.mocked(serve)).not.toHaveBeenCalled();
  });

  it('exits with code 1 and does not bind the server on ConfigNotFoundError', async () => {
    vi.mocked(loadConfig).mockImplementationOnce(() => {
      throw new ConfigNotFoundError('config.yaml not found');
    });

    await boot(VALID_ENV);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(vi.mocked(serve)).not.toHaveBeenCalled();
  });
});
