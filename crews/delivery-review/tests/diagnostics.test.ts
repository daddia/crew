import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDiagnostics, type DiagnosticsOptions } from '../src/diagnostics.js';
import { loadConfig } from '../src/config.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const FIXTURE_CONFIG = loadConfig({
  CREW_ID: 'delivery-review-test',
  ATLASSIAN_BASE_URL: 'https://test.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@test.example.com',
  JIRA_PROJECT_KEY: 'CREW',
  JIRA_ASSIGNEE_ACCOUNT_ID: 'account-123',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  PM_APPROVER_ACCOUNT_IDS: 'account-pm',
  GITLAB_API_URL: 'https://gitlab.test/api/v4',
  GITLAB_PROJECT_ID: 'org/repo',
  DB_PATH: '/data/crew.db',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-webhook-secret-ok',
});

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ALL_TRANSITIONS = [
  { name: 'In Review', to: { name: 'In Review' } },
  { name: 'Done', to: { name: 'Done' } },
  { name: 'Needs human review', to: { name: 'Needs human review' } },
];

function setupHappyPathFetch(): void {
  fetchMock
    .mockResolvedValueOnce(mockJson({ issues: [{ key: 'CREW-1' }] }))
    .mockResolvedValueOnce(mockJson({ id: 'CREW', key: 'CREW' }))
    .mockResolvedValueOnce(mockJson({ transitions: ALL_TRANSITIONS }))
    .mockResolvedValueOnce(mockJson({ id: 1, path_with_namespace: 'org/repo' }))
    .mockResolvedValueOnce(mockJson([]));
}

const passingMcpCheck = async (): Promise<
  ReturnType<NonNullable<DiagnosticsOptions['checkMcpServers']>>
> => ({
  name: 'MCP servers boot',
  ok: true,
  detail: 'all 2 MCP server(s) responded to initialize',
});

const passingDirCheck = async (): Promise<
  ReturnType<NonNullable<DiagnosticsOptions['checkDirWritable']>>
> => ({ name: 'DB_PATH directory writable', ok: true, detail: '/data' });

const injectPassing: DiagnosticsOptions = {
  checkMcpServers: passingMcpCheck,
  checkDirWritable: passingDirCheck,
};

describe('runDiagnostics – all checks pass', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setupHappyPathFetch();
  });

  it('returns exactly seven checks', async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks).toHaveLength(7);
  });

  it('all seven checks are ok', async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.filter((c) => !c.ok)).toHaveLength(0);
  });

  it('check names are present in the expected order', async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.map((c) => c.name)).toEqual([
      'Jira API reachability',
      'Jira project key',
      'Jira transitions',
      'GitLab API reachability',
      'GitLab MR lookup',
      'MCP servers boot',
      'DB_PATH directory writable',
    ]);
  });

  it('MR lookup uses the first Jira issue key as probe', async () => {
    await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const mrCall = fetchMock.mock.calls[4];
    expect(String(mrCall?.[0])).toContain('merge_requests');
    expect(String(mrCall?.[0])).toContain('search=CREW-1');
  });
});

describe('runDiagnostics – individual failures', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('reports Jira API reachability failure', async () => {
    fetchMock.mockResolvedValueOnce(mockJson({}, 500));
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const jiraCheck = checks.find((c) => c.name === 'Jira API reachability');
    expect(jiraCheck?.ok).toBe(false);
  });

  it('reports GitLab MR lookup failure', async () => {
    setupHappyPathFetch();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [{ key: 'CREW-1' }] }))
      .mockResolvedValueOnce(mockJson({ id: 'CREW', key: 'CREW' }))
      .mockResolvedValueOnce(mockJson({ transitions: ALL_TRANSITIONS }))
      .mockResolvedValueOnce(mockJson({ id: 1 }))
      .mockResolvedValueOnce(mockJson({}, 403));

    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const mrCheck = checks.find((c) => c.name === 'GitLab MR lookup');
    expect(mrCheck?.ok).toBe(false);
    expect(mrCheck?.detail).toContain('403');
  });

  it('falls back to project-key probe when Jira search returns no issues', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [] }))
      .mockResolvedValueOnce(mockJson({ id: 'CREW', key: 'CREW' }))
      .mockResolvedValueOnce(mockJson({ transitions: ALL_TRANSITIONS }))
      .mockResolvedValueOnce(mockJson({ id: 1 }))
      .mockResolvedValueOnce(mockJson([]));

    await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('search=CREW-1');
  });
});
