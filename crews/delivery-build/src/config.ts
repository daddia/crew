import { z } from "zod";
import { Secret, loadEnv, type EnvMapping } from "@daddia/crew/config";

export const CONFIG_SCHEMA_VERSION = 1 as const;

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1),
    jira: z.object({
      baseUrl: z.string().url(),
      email: z.string().email(),
      projectKey: z.string().min(1),
      assigneeAccountId: z.string().min(1),
      /**
       * Optional Jira account ID of the bot account. When set, comment
       * authorship is matched by account ID instead of email address, which
       * is more reliable when email may vary between Jira contexts.
       */
      botAccountId: z.string().optional(),
    }),
    gitlab: z.object({
      apiUrl: z.string().url(),
      projectId: z.string().min(1),
    }),
  }),
  behaviour: z.object({
    pollIntervalMs: z.coerce.number().int().positive().default(300_000),
    refactorLoopCap: z.coerce.number().int().nonnegative().default(2),
    ciRetryCap: z.coerce.number().int().nonnegative().default(3),
    ciPollIntervalMs: z.coerce.number().int().positive().default(30_000),
    clarificationTimeoutHours: z.coerce.number().int().positive().default(24),
    anthropicModel: z.string().min(1).optional(),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  infrastructure: z.object({
    port: z.coerce.number().int().positive().default(3000),
    dbPath: z.string().min(1),
    projectDir: z.string().min(1),
  }),
  secrets: z.object({
    anthropicApiKey: Secret(z.string().min(1)),
    atlassianApiToken: Secret(z.string().min(1)),
    gitlabAccessToken: Secret(z.string().min(1)),
    jiraWebhookSecret: Secret(z.string().min(16)),
    gitlabWebhookSecret: Secret(z.string().min(16)),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_MAPPING: EnvMapping = {
  "identity.crewId":                       "CREW_ID",
  "identity.jira.baseUrl":                 "ATLASSIAN_BASE_URL",
  "identity.jira.email":                   "ATLASSIAN_EMAIL",
  "identity.jira.projectKey":              "JIRA_PROJECT_KEY",
  "identity.jira.assigneeAccountId":       "JIRA_ASSIGNEE_ACCOUNT_ID",
  "identity.jira.botAccountId":            "ATLASSIAN_ACCOUNT_ID",
  "identity.gitlab.apiUrl":                "GITLAB_API_URL",
  "identity.gitlab.projectId":             "GITLAB_PROJECT_ID",
  "behaviour.pollIntervalMs":              "POLL_INTERVAL_MS",
  "behaviour.refactorLoopCap":             "REFACTOR_LOOP_CAP",
  "behaviour.ciRetryCap":                  "CI_RETRY_CAP",
  "behaviour.ciPollIntervalMs":            "CI_POLL_INTERVAL_MS",
  "behaviour.clarificationTimeoutHours":   "CLARIFICATION_TIMEOUT_HOURS",
  "behaviour.anthropicModel":              "ANTHROPIC_MODEL",
  "behaviour.logLevel":                    "LOG_LEVEL",
  "infrastructure.port":                   "PORT",
  "infrastructure.dbPath":                 "DB_PATH",
  "infrastructure.projectDir":             "PROJECT_DIR",
  "secrets.anthropicApiKey":               "ANTHROPIC_API_KEY",
  "secrets.atlassianApiToken":             "ATLASSIAN_API_TOKEN",
  "secrets.gitlabAccessToken":             "GITLAB_PERSONAL_ACCESS_TOKEN",
  "secrets.jiraWebhookSecret":             "JIRA_WEBHOOK_SECRET",
  "secrets.gitlabWebhookSecret":           "GITLAB_WEBHOOK_SECRET",
};

/**
 * Read and validate the delivery-build runtime configuration from environment
 * variables. Called once at process startup; throws SchemaValidationError if
 * any required field is absent or invalid, preventing the server from binding.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
