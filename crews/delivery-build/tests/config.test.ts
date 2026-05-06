import { describe, it, expect } from "vitest";
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from "../src/config.js";
import { SchemaValidationError, redact } from "@daddia/crew/config";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  CREW_ID: "delivery-build-acme",
  ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
  ATLASSIAN_EMAIL: "bot@acme.example.com",
  JIRA_PROJECT_KEY: "ACME",
  JIRA_ASSIGNEE_ACCOUNT_ID: "5b10ac8d82e05b22cc7d4ef5",
  GITLAB_API_URL: "https://gitlab.com/api/v4",
  GITLAB_PROJECT_ID: "12345678",
  DB_PATH: "/data/delivery-build.db",
  PROJECT_DIR: "/workspace/acme",
  ANTHROPIC_API_KEY: "sk-ant-key",
  ATLASSIAN_API_TOKEN: "atlassian-api-token",
  GITLAB_PERSONAL_ACCESS_TOKEN: "glpat-token",
  JIRA_WEBHOOK_SECRET: "jira-webhook-secret-ok",
  GITLAB_WEBHOOK_SECRET: "gitlab-webhook-secret-ok",
};

describe("loadConfig – valid config", () => {
  it("returns a fully typed Config from a complete env", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.identity.crewId).toBe("delivery-build-acme");
    expect(config.identity.jira.baseUrl).toBe("https://acme.atlassian.net");
    expect(config.identity.jira.email).toBe("bot@acme.example.com");
    expect(config.identity.jira.projectKey).toBe("ACME");
    expect(config.identity.jira.assigneeAccountId).toBe("5b10ac8d82e05b22cc7d4ef5");
    expect(config.identity.gitlab.apiUrl).toBe("https://gitlab.com/api/v4");
    expect(config.identity.gitlab.projectId).toBe("12345678");
    expect(config.infrastructure.dbPath).toBe("/data/delivery-build.db");
    expect(config.infrastructure.projectDir).toBe("/workspace/acme");
  });

  it("exports CONFIG_SCHEMA_VERSION = 1", () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
  });

  it("ConfigSchema is a valid Zod schema that accepts REQUIRED_ENV-shaped data", () => {
    const config = loadConfig(REQUIRED_ENV);
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

describe("loadConfig – behaviour defaults", () => {
  it("defaults pollIntervalMs to 300000 when POLL_INTERVAL_MS is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.pollIntervalMs).toBe(300_000);
  });

  it("defaults refactorLoopCap to 2 when REFACTOR_LOOP_CAP is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.refactorLoopCap).toBe(2);
  });

  it("defaults ciRetryCap to 3 when CI_RETRY_CAP is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.ciRetryCap).toBe(3);
  });

  it("defaults ciPollIntervalMs to 30000 when CI_POLL_INTERVAL_MS is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.ciPollIntervalMs).toBe(30_000);
  });

  it("defaults clarificationTimeoutHours to 24", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.clarificationTimeoutHours).toBe(24);
  });

  it("defaults infrastructure.port to 3000 when PORT is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.infrastructure.port).toBe(3000);
  });

  it("coerces numeric strings to numbers", () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      POLL_INTERVAL_MS: "60000",
      REFACTOR_LOOP_CAP: "5",
      PORT: "8080",
    });
    expect(config.behaviour.pollIntervalMs).toBe(60_000);
    expect(config.behaviour.refactorLoopCap).toBe(5);
    expect(config.infrastructure.port).toBe(8080);
  });
});

describe("loadConfig – optional fields", () => {
  it("anthropicModel is undefined when ANTHROPIC_MODEL is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.anthropicModel).toBeUndefined();
  });

  it("anthropicModel is set when ANTHROPIC_MODEL is present", () => {
    const config = loadConfig({ ...REQUIRED_ENV, ANTHROPIC_MODEL: "claude-opus-4-7" });
    expect(config.behaviour.anthropicModel).toBe("claude-opus-4-7");
  });

  it("botAccountId is undefined when ATLASSIAN_ACCOUNT_ID is absent", () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.identity.jira.botAccountId).toBeUndefined();
  });

  it("botAccountId is populated when ATLASSIAN_ACCOUNT_ID is present", () => {
    const config = loadConfig({ ...REQUIRED_ENV, ATLASSIAN_ACCOUNT_ID: "bot-id-123" });
    expect(config.identity.jira.botAccountId).toBe("bot-id-123");
  });
});

describe("loadConfig – identity validation errors", () => {
  it("throws SchemaValidationError when CREW_ID is missing", () => {
    const env = { ...REQUIRED_ENV };
    delete env["CREW_ID"];
    expect(() => loadConfig(env)).toThrow(SchemaValidationError);
  });

  it("includes identity.crewId in the issues path when CREW_ID is missing", () => {
    const env = { ...REQUIRED_ENV };
    delete env["CREW_ID"];
    let err: SchemaValidationError | null = null;
    try { loadConfig(env); } catch (e) { err = e as SchemaValidationError; }
    expect(err!.issues.some(i => i.path.includes("crewId"))).toBe(true);
  });

  it("throws when JIRA_PROJECT_KEY is missing", () => {
    const env = { ...REQUIRED_ENV };
    delete env["JIRA_PROJECT_KEY"];
    let err: SchemaValidationError | null = null;
    try { loadConfig(env); } catch (e) { err = e as SchemaValidationError; }
    expect(err!.issues.some(i => i.path.includes("projectKey"))).toBe(true);
  });

  it("throws SchemaValidationError naming identity.jira.baseUrl when ATLASSIAN_BASE_URL is not a URL", () => {
    let err: SchemaValidationError | null = null;
    try {
      loadConfig({ ...REQUIRED_ENV, ATLASSIAN_BASE_URL: "not-a-url" });
    } catch (e) { err = e as SchemaValidationError; }
    expect(err).not.toBeNull();
    expect(err!.issues.some(i => i.path.includes("baseUrl"))).toBe(true);
  });
});

describe("loadConfig – secrets validation errors", () => {
  it("throws when JIRA_WEBHOOK_SECRET is shorter than 16 chars", () => {
    let err: SchemaValidationError | null = null;
    try {
      loadConfig({ ...REQUIRED_ENV, JIRA_WEBHOOK_SECRET: "tooshort" });
    } catch (e) { err = e as SchemaValidationError; }
    expect(err).not.toBeNull();
    expect(err!.issues.some(i => i.path.includes("jiraWebhookSecret"))).toBe(true);
  });

  it("throws when GITLAB_WEBHOOK_SECRET is shorter than 16 chars", () => {
    let err: SchemaValidationError | null = null;
    try {
      loadConfig({ ...REQUIRED_ENV, GITLAB_WEBHOOK_SECRET: "tooshort" });
    } catch (e) { err = e as SchemaValidationError; }
    expect(err).not.toBeNull();
    expect(err!.issues.some(i => i.path.includes("gitlabWebhookSecret"))).toBe(true);
  });

  it("throws when ANTHROPIC_API_KEY is missing", () => {
    const env = { ...REQUIRED_ENV };
    delete env["ANTHROPIC_API_KEY"];
    expect(() => loadConfig(env)).toThrow(SchemaValidationError);
  });
});

describe("loadConfig – redaction", () => {
  it("replaces all five secret fields with '***' after redact()", () => {
    const config = loadConfig(REQUIRED_ENV);
    const safe = redact(config);
    expect(safe.secrets.anthropicApiKey).toBe("***");
    expect(safe.secrets.atlassianApiToken).toBe("***");
    expect(safe.secrets.gitlabAccessToken).toBe("***");
    expect(safe.secrets.jiraWebhookSecret).toBe("***");
    expect(safe.secrets.gitlabWebhookSecret).toBe("***");
  });

  it("preserves all non-secret fields after redact()", () => {
    const config = loadConfig(REQUIRED_ENV);
    const safe = redact(config);
    expect(safe.identity.crewId).toBe("delivery-build-acme");
    expect(safe.identity.jira.projectKey).toBe("ACME");
    expect(safe.behaviour.pollIntervalMs).toBe(300_000);
    expect(safe.infrastructure.dbPath).toBe("/data/delivery-build.db");
  });

  it("does not mutate the original Config object", () => {
    const config = loadConfig(REQUIRED_ENV);
    redact(config);
    // Secrets should still hold their real values on the original
    expect(String(config.secrets.anthropicApiKey)).toBe("sk-ant-key");
  });
});
