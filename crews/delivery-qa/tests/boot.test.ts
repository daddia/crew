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
  }),
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

const VALID_ENV: NodeJS.ProcessEnv = {
  CREW_ID: 'delivery-qa-acme',
  ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@acme.example.com',
  JIRA_PROJECT_KEY: 'ACME',
  JIRA_ASSIGNEE_ACCOUNT_ID: '5b10ac8d82e05b22cc7d4ef5',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  GITLAB_API_URL: 'https://gitlab.com/api/v4',
  GITLAB_PROJECT_ID: '12345678',
  DB_PATH: '/data/delivery-qa.db',
  PROJECT_DIR: '/workspace/acme',
  QA_WORKSPACE_DIR: '/workspace/acme/qa',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-api-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-webhook-secret-ok',
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
      expect.objectContaining({ serviceName: 'delivery-qa' }),
    );
  });

  it('emits exactly one config.loaded log line', async () => {
    await boot(VALID_ENV);
    const calls = mockLog.info.mock.calls.filter((c) => c[0] === 'config.loaded');
    expect(calls).toHaveLength(1);
  });

  it('starts the HTTP server on the configured port', async () => {
    await boot({ ...VALID_ENV, PORT: '4001' });
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ port: 4001 }), expect.any(Function));
  });
});
