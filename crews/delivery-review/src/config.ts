import { z } from 'zod';
import { Secret, loadEnv, type EnvMapping } from '@daddia/crew/config';

export const CONFIG_SCHEMA_VERSION = 1 as const;

const commaSeparatedIds = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return val;
  },
  z.array(z.string().min(1)).min(1),
);

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1).default('delivery-review'),
    jira: z.object({
      baseUrl: z.string().url(),
      email: z.string().email(),
      projectKey: z.string().min(1),
      assigneeAccountId: z.string().min(1),
      botAccountId: z.string().optional(),
      acceptanceCriteriaFieldId: z
        .string()
        .regex(/^customfield_\d+$/, 'must be a Jira custom-field ID (customfield_NNNNN)'),
      pmApproverAccountIds: commaSeparatedIds,
    }),
    gitlab: z.object({
      apiUrl: z.string().url(),
      projectId: z.string().min(1),
      defaultBranch: z.string().min(1).default('main'),
    }),
  }),
  behaviour: z.object({
    pollIntervalMs: z.coerce.number().int().positive().default(300_000),
    pmReviewTimeoutHours: z.coerce.number().int().positive().default(48),
    pmApprovalCommentPattern: z.string().min(1).default('/pm-approve'),
    techLeadMaxTurns: z.coerce.number().int().positive().default(30),
    techLeadCostCapUsd: z.coerce.number().positive().default(5),
    diffFileCap: z.coerce.number().int().positive().default(50),
    diffSizeCapBytes: z.coerce.number().int().positive().default(500_000),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    evalFixtureMode: z.enum(['mock', 'live']).default('mock'),
  }),
  infrastructure: z.object({
    port: z.coerce.number().int().positive().default(3002),
    dbPath: z.string().min(1),
  }),
  secrets: z.object({
    anthropicApiKey: Secret(z.string().min(1)),
    atlassianApiToken: Secret(z.string().min(1)),
    gitlabAccessToken: Secret(z.string().min(1)),
    jiraWebhookSecret: Secret(z.string().min(16)),
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
  'identity.jira.pmApproverAccountIds': 'PM_APPROVER_ACCOUNT_IDS',
  'identity.gitlab.apiUrl': 'GITLAB_API_URL',
  'identity.gitlab.projectId': 'GITLAB_PROJECT_ID',
  'identity.gitlab.defaultBranch': 'GITLAB_DEFAULT_BRANCH',
  'behaviour.pollIntervalMs': 'POLL_INTERVAL_MS',
  'behaviour.pmReviewTimeoutHours': 'PM_REVIEW_TIMEOUT_HOURS',
  'behaviour.pmApprovalCommentPattern': 'PM_APPROVAL_COMMENT_PATTERN',
  'behaviour.techLeadMaxTurns': 'TECH_LEAD_MAX_TURNS',
  'behaviour.techLeadCostCapUsd': 'TECH_LEAD_COST_CAP_USD',
  'behaviour.diffFileCap': 'DIFF_FILE_CAP',
  'behaviour.diffSizeCapBytes': 'DIFF_SIZE_CAP_BYTES',
  'behaviour.logLevel': 'LOG_LEVEL',
  'behaviour.evalFixtureMode': 'CREW_EVAL_FIXTURE_MODE',
  'infrastructure.port': 'PORT',
  'infrastructure.dbPath': 'DB_PATH',
  'secrets.anthropicApiKey': 'ANTHROPIC_API_KEY',
  'secrets.atlassianApiToken': 'ATLASSIAN_API_TOKEN',
  'secrets.gitlabAccessToken': 'GITLAB_PERSONAL_ACCESS_TOKEN',
  'secrets.jiraWebhookSecret': 'JIRA_WEBHOOK_SECRET',
  'secrets.honeycombApiKey': 'HONEYCOMB_API_KEY',
};

/**
 * Read and validate the delivery-review runtime configuration from environment
 * variables. Called once at process startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
