import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDiagnostics, type DiagnosticsOptions } from "../src/diagnostics.js";
import { loadConfig } from "../src/config.js";

// ── Fetch mock ────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ── Fixture config ────────────────────────────────────────────────────────────

const FIXTURE_CONFIG = loadConfig({
  CREW_ID: "delivery-build-test",
  ATLASSIAN_BASE_URL: "https://test.atlassian.net",
  ATLASSIAN_EMAIL: "bot@test.example.com",
  JIRA_PROJECT_KEY: "CREW",
  JIRA_ASSIGNEE_ACCOUNT_ID: "account-123",
  GITLAB_API_URL: "https://gitlab.test/api/v4",
  GITLAB_PROJECT_ID: "org/repo",
  DB_PATH: "/data/crew.db",
  PROJECT_DIR: "/workspace",
  ANTHROPIC_API_KEY: "sk-ant-key",
  ATLASSIAN_API_TOKEN: "atlassian-token",
  GITLAB_PERSONAL_ACCESS_TOKEN: "glpat-token",
  JIRA_WEBHOOK_SECRET: "jira-webhook-secret-ok",
  GITLAB_WEBHOOK_SECRET: "gitlab-webhook-secret-ok",
});

// ── Shared helpers ────────────────────────────────────────────────────────────

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALL_TRANSITIONS = [
  { name: "In Progress", to: { name: "In Progress" } },
  { name: "Clarification Needed", to: { name: "Clarification Needed" } },
  { name: "In QA", to: { name: "In QA" } },
  { name: "Needs human review", to: { name: "Needs human review" } },
  { name: "To Do", to: { name: "To Do" } },
];

function setupHappyPathFetch(): void {
  fetchMock
    // check 1: Jira search
    .mockResolvedValueOnce(mockJson({ issues: [{ key: "CREW-1" }] }))
    // check 2: Jira project
    .mockResolvedValueOnce(mockJson({ id: "CREW", key: "CREW" }))
    // check 3: Jira transitions
    .mockResolvedValueOnce(mockJson({ transitions: ALL_TRANSITIONS }))
    // check 4: GitLab project
    .mockResolvedValueOnce(mockJson({ id: 1, path_with_namespace: "org/repo" }));
}

const passingMcpCheck = async (): Promise<ReturnType<NonNullable<DiagnosticsOptions["checkMcpServers"]>>> =>
  ({ name: "MCP servers boot", ok: true, detail: "all 2 MCP server(s) responded to initialize" });

const passingDirCheck = async (): Promise<ReturnType<NonNullable<DiagnosticsOptions["checkDirWritable"]>>> =>
  ({ name: "DB_PATH directory writable", ok: true, detail: "/data" });

const injectPassing: DiagnosticsOptions = {
  checkMcpServers: passingMcpCheck,
  checkDirWritable: passingDirCheck,
};

// ── All checks pass (EARS §1 + §3 + Gherkin scenario 1) ────────────────────

describe("runDiagnostics – all checks pass", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setupHappyPathFetch();
  });

  it("returns exactly six checks", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks).toHaveLength(6);
  });

  it("all six checks are ok", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const failed = checks.filter((c) => !c.ok);
    expect(failed).toHaveLength(0);
  });

  it("check names are present in the expected order", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.map((c) => c.name)).toEqual([
      "Jira API reachability",
      "Jira project key",
      "Jira transitions",
      "GitLab API reachability",
      "MCP servers boot",
      "DB_PATH directory writable",
    ]);
  });

  it("Jira reachability detail names the base URL", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira API reachability")!;
    expect(check.detail).toContain("https://test.atlassian.net");
  });

  it("Jira project key detail names the project key", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira project key")!;
    expect(check.detail).toContain("CREW");
  });

  it("Jira transitions detail confirms all four present", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira transitions")!;
    expect(check.ok).toBe(true);
    expect(check.detail).toContain("all four required transitions present");
  });

  it("GitLab reachability detail names the API URL", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "GitLab API reachability")!;
    expect(check.detail).toContain("https://gitlab.test/api/v4");
  });
});

// ── Transition missing (EARS §4 + Gherkin scenario 2) ───────────────────────

describe("runDiagnostics – Jira transition missing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [{ key: "CREW-1" }] }))
      .mockResolvedValueOnce(mockJson({ id: "CREW", key: "CREW" }))
      // transitions response WITHOUT "Clarification Needed"
      .mockResolvedValueOnce(
        mockJson({
          transitions: [
            { name: "In Progress", to: { name: "In Progress" } },
            { name: "In QA", to: { name: "In QA" } },
            { name: "Needs human review", to: { name: "Needs human review" } },
          ],
        }),
      )
      .mockResolvedValueOnce(mockJson({ id: 1 }));
  });

  it("transitions check is not ok", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira transitions")!;
    expect(check.ok).toBe(false);
  });

  it("transitions check detail names the missing transition", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira transitions")!;
    expect(check.detail).toContain("Clarification Needed");
  });

  it("other checks are not affected by the transitions failure", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "Jira project key")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "GitLab API reachability")!.ok).toBe(true);
  });
});

describe("runDiagnostics – multiple Jira transitions missing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [{ key: "CREW-1" }] }))
      .mockResolvedValueOnce(mockJson({ id: "CREW" }))
      .mockResolvedValueOnce(
        mockJson({
          transitions: [
            { name: "To Do", to: { name: "To Do" } },
          ],
        }),
      )
      .mockResolvedValueOnce(mockJson({ id: 1 }));
  });

  it("detail lists all four missing transition names", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira transitions")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("In Progress");
    expect(check.detail).toContain("Clarification Needed");
    expect(check.detail).toContain("In QA");
    expect(check.detail).toContain("Needs human review");
  });
});

// ── GitLab unreachable (EARS §2 + Gherkin scenario 3) ───────────────────────

describe("runDiagnostics – GitLab project unreachable", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [{ key: "CREW-1" }] }))
      .mockResolvedValueOnce(mockJson({ id: "CREW" }))
      .mockResolvedValueOnce(mockJson({ transitions: ALL_TRANSITIONS }))
      // GitLab returns 401 (invalid token)
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
  });

  it("GitLab check is not ok", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "GitLab API reachability")!;
    expect(check.ok).toBe(false);
  });

  it("GitLab check detail includes the HTTP status code", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "GitLab API reachability")!;
    expect(check.detail).toContain("401");
  });

  it("Jira checks still pass", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "Jira project key")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "Jira transitions")!.ok).toBe(true);
  });
});

// ── Jira search returns no issues ────────────────────────────────────────────

describe("runDiagnostics – Jira search returns no issues", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(mockJson({ issues: [] }))
      .mockResolvedValueOnce(mockJson({ id: "CREW" }))
      // no third call — transitions check is skipped when no issue key
      .mockResolvedValueOnce(mockJson({ id: 1 }));
  });

  it("Jira reachability passes even with an empty result", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.ok).toBe(true);
  });

  it("transitions check fails with 'no issues found' detail", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira transitions")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("no issues found");
  });
});

// ── Jira API is unreachable ──────────────────────────────────────────────────

describe("runDiagnostics – Jira API unreachable (HTTP 500)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      // no transitions call — no issueKey
      .mockResolvedValueOnce(mockJson({ id: 1 }));
  });

  it("Jira reachability check is not ok", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.ok).toBe(false);
  });

  it("Jira reachability detail includes the HTTP status", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.detail).toContain("500");
  });

  it("transitions check is not ok when reachability fails and no issueKey is available", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira transitions")!.ok).toBe(false);
  });
});

// ── DB directory not writable ────────────────────────────────────────────────

describe("runDiagnostics – DB directory not writable", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setupHappyPathFetch();
  });

  it("DB check is not ok when the directory is not writable", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, {
      ...injectPassing,
      checkDirWritable: async () => ({
        name: "DB_PATH directory writable",
        ok: false,
        detail: "/data is not writable",
      }),
    });
    const check = checks.find((c) => c.name === "DB_PATH directory writable")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("not writable");
  });

  it("DB check detail names the directory path", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, {
      ...injectPassing,
      checkDirWritable: async () => ({
        name: "DB_PATH directory writable",
        ok: false,
        detail: "/data is not writable",
      }),
    });
    const check = checks.find((c) => c.name === "DB_PATH directory writable")!;
    expect(check.detail).toContain("/data");
  });
});

// ── MCP server check fails ───────────────────────────────────────────────────

describe("runDiagnostics – MCP server fails to boot", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setupHappyPathFetch();
  });

  it("MCP check is not ok when a server fails to handshake", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, {
      ...injectPassing,
      checkMcpServers: async () => ({
        name: "MCP servers boot",
        ok: false,
        detail: "atlassian: timed out waiting for MCP handshake",
      }),
    });
    const check = checks.find((c) => c.name === "MCP servers boot")!;
    expect(check.ok).toBe(false);
  });
});

// ── Jira auth header is correctly formed ────────────────────────────────────

describe("runDiagnostics – auth headers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setupHappyPathFetch();
  });

  it("sends Basic auth header on Jira requests", async () => {
    await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Basic /);
  });

  it("sends PRIVATE-TOKEN header on GitLab requests", async () => {
    await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    // GitLab is the 4th fetch call (index 3)
    const [, gitlabInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    const headers = gitlabInit?.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("glpat-token");
  });
});

// ── Fetch error (network failure) ────────────────────────────────────────────

describe("runDiagnostics – network error on Jira search", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(mockJson({ id: "CREW" }))
      // no transitions call
      .mockResolvedValueOnce(mockJson({ id: 1 }));
  });

  it("Jira reachability check is not ok", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks.find((c) => c.name === "Jira API reachability")!.ok).toBe(false);
  });

  it("error detail contains the error message", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    const check = checks.find((c) => c.name === "Jira API reachability")!;
    expect(check.detail).toContain("fetch failed");
  });

  it("still returns six checks even when fetch throws", async () => {
    const checks = await runDiagnostics(FIXTURE_CONFIG, injectPassing);
    expect(checks).toHaveLength(6);
  });
});
