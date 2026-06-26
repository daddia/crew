import { z } from 'zod';
import { Secret, loadEnv, type EnvMapping } from '@daddia/crew/config';

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
      /** Jira custom-field ID for acceptance criteria (e.g. customfield_10042). */
      acceptanceCriteriaFieldId: z
        .string()
        .regex(/^customfield_\d+$/, 'must be a Jira custom-field ID (customfield_NNNNN)'),
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
    ciPollIntervalMs: z.coerce.number().int().nonnegative().default(30_000),
    ciWaitTimeoutMs: z.coerce.number().int().nonnegative().default(1_800_000),
    clarificationTimeoutHours: z.coerce.number().int().positive().default(24),
    diffFileCap: z.coerce.number().int().positive().default(50),
    diffSizeCapBytes: z.coerce.number().int().positive().default(500_000),
    engineerMaxTurns: z.coerce.number().int().positive().default(50),
    engineerCompactionThreshold: z.coerce
      .number()
      .int()
      .min(100_000)
      .max(1_000_000)
      .default(160_000),
    engineerCostCapUsd: z.coerce.number().positive().default(5),
    modelRouting: z
      .object({
        lowCost: z.string().min(1).default('claude-sonnet-4-6'),
        implementation: z.string().min(1).default('claude-opus-4-5'),
      })
      .default({
        lowCost: 'claude-sonnet-4-6',
        implementation: 'claude-opus-4-5',
      }),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** CrewBench fixture mode: mock (default) or live agent sessions. */
    evalFixtureMode: z.enum(['mock', 'live']).default('mock'),
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
    honeycombApiKey: Secret(z.string().min(1)).optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_MAPPING: EnvMapping = {
  'identity.crewId': 'CREW_ID',
  'identity.jira.baseUrl': 'ATLASSIAN_BASE_URL',
  'identity.jira.email': 'ATLASSIAN_EMAIL',
  'identity.jira.projectKey': 'JIRA_PROJECT_KEY',
  'identity.jira.assigneeAccountId': 'JIRA_ASSIGNEE_ACCOUNT_ID',
  'identity.jira.botAccountId': 'ATLASSIAN_ACCOUNT_ID',
  'identity.jira.acceptanceCriteriaFieldId': 'JIRA_ACCEPTANCE_CRITERIA_FIELD_ID',
  'identity.gitlab.apiUrl': 'GITLAB_API_URL',
  'identity.gitlab.projectId': 'GITLAB_PROJECT_ID',
  'behaviour.pollIntervalMs': 'POLL_INTERVAL_MS',
  'behaviour.refactorLoopCap': 'REFACTOR_LOOP_CAP',
  'behaviour.ciRetryCap': 'CI_RETRY_CAP',
  'behaviour.ciPollIntervalMs': 'CI_POLL_INTERVAL_MS',
  'behaviour.ciWaitTimeoutMs': 'CI_WAIT_TIMEOUT_MS',
  'behaviour.clarificationTimeoutHours': 'CLARIFICATION_TIMEOUT_HOURS',
  'behaviour.diffFileCap': 'DIFF_FILE_CAP',
  'behaviour.diffSizeCapBytes': 'DIFF_SIZE_CAP_BYTES',
  'behaviour.engineerMaxTurns': 'ENGINEER_MAX_TURNS',
  'behaviour.engineerCompactionThreshold': 'ENGINEER_COMPACTION_THRESHOLD',
  'behaviour.engineerCostCapUsd': 'ENGINEER_COST_CAP_USD',
  'behaviour.modelRouting.lowCost': 'MODEL_ROUTING_LOW_COST',
  'behaviour.modelRouting.implementation': 'MODEL_ROUTING_IMPLEMENTATION',
  'behaviour.logLevel': 'LOG_LEVEL',
  'behaviour.evalFixtureMode': 'CREW_EVAL_FIXTURE_MODE',
  'infrastructure.port': 'PORT',
  'infrastructure.dbPath': 'DB_PATH',
  'infrastructure.projectDir': 'PROJECT_DIR',
  'secrets.anthropicApiKey': 'ANTHROPIC_API_KEY',
  'secrets.atlassianApiToken': 'ATLASSIAN_API_TOKEN',
  'secrets.gitlabAccessToken': 'GITLAB_PERSONAL_ACCESS_TOKEN',
  'secrets.jiraWebhookSecret': 'JIRA_WEBHOOK_SECRET',
  'secrets.gitlabWebhookSecret': 'GITLAB_WEBHOOK_SECRET',
  'secrets.honeycombApiKey': 'HONEYCOMB_API_KEY',
};

/**
 * Read and validate the delivery-build runtime configuration from environment
 * variables. Called once at process startup; throws SchemaValidationError if
 * any required field is absent or invalid, preventing the server from binding.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
