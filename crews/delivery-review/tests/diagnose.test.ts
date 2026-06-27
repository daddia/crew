import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/diagnostics.js', () => ({
  runDiagnostics: vi.fn(),
}));

import { main } from '../src/diagnose.js';
import { runDiagnostics } from '../src/diagnostics.js';

const mockRunDiagnostics = vi.mocked(runDiagnostics);

const VALID_ENV: NodeJS.ProcessEnv = {
  CREW_ID: 'delivery-review',
  ATLASSIAN_BASE_URL: 'https://test.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@example.com',
  JIRA_PROJECT_KEY: 'TEST',
  JIRA_ASSIGNEE_ACCOUNT_ID: 'acct-123',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  PM_APPROVER_ACCOUNT_IDS: 'acct-pm',
  GITLAB_API_URL: 'https://gitlab.test/api/v4',
  GITLAB_PROJECT_ID: 'org/repo',
  DB_PATH: '/data/crew.db',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-secret-abcdef',
};

const PASSING_CHECKS = [
  { name: 'Jira API reachability', ok: true, detail: 'reachable' },
  { name: 'Jira project key', ok: true, detail: 'exists' },
  { name: 'Jira transitions', ok: true, detail: 'all three required transitions present' },
  { name: 'GitLab API reachability', ok: true, detail: 'reachable' },
  { name: 'GitLab MR lookup', ok: true, detail: 'MR search API responded for probe key CREW-1' },
  { name: 'MCP servers boot', ok: true, detail: 'all 2 responded' },
  { name: 'DB_PATH directory writable', ok: true, detail: '/data' },
];

describe('diagnose main() — exit codes', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
  });

  it('exits with 0 when all checks pass', async () => {
    mockRunDiagnostics.mockResolvedValue(PASSING_CHECKS);
    await main(VALID_ENV);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('exits with 1 when any check fails', async () => {
    mockRunDiagnostics.mockResolvedValue([
      ...PASSING_CHECKS.slice(0, 4),
      { name: 'GitLab MR lookup', ok: false, detail: 'HTTP 403' },
      ...PASSING_CHECKS.slice(5),
    ]);
    await main(VALID_ENV);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits with 1 when config is invalid (missing required env var)', async () => {
    const invalidEnv = { ...VALID_ENV, ANTHROPIC_API_KEY: undefined };
    await main(invalidEnv);
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
  });

  it('does not call runDiagnostics when config fails to load', async () => {
    await main({});
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
  });
});

describe('diagnose main() — summary line', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints one line per check including Jira GitLab and MR lookup', async () => {
    mockRunDiagnostics.mockResolvedValue(PASSING_CHECKS);
    await main(VALID_ENV);
    const joined = consoleOutput.join('\n');
    expect(joined).toMatch(/Jira API reachability/);
    expect(joined).toMatch(/GitLab API reachability/);
    expect(joined).toMatch(/GitLab MR lookup/);
  });

  it('final summary line names failing checks', async () => {
    mockRunDiagnostics.mockResolvedValue([
      { name: 'Jira API reachability', ok: false, detail: 'HTTP 500' },
      ...PASSING_CHECKS.slice(1),
    ]);
    await main(VALID_ENV);
    const summaryLine = consoleOutput.find((l) => l.includes('check') && l.includes('failed'));
    expect(summaryLine).toContain('Jira API reachability');
  });

  it('final summary line reports all-pass on success', async () => {
    mockRunDiagnostics.mockResolvedValue(PASSING_CHECKS);
    await main(VALID_ENV);
    const summaryLine = consoleOutput.find((l) => l.includes('passed'));
    expect(summaryLine).toContain('7');
  });
});
