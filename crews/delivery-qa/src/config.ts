import { z } from 'zod';
import { Secret, loadEnv, type EnvMapping } from '@daddia/crew/config';

export const CONFIG_SCHEMA_VERSION = 1 as const;

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1).default('delivery-qa'),
    jira: z.object({
      baseUrl: z.string().url(),
      email: z.string().email(),
      projectKey: z.string().min(1),
      assigneeAccountId: z.string().min(1),
      botAccountId: z.string().optional(),
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
    qaDefectLoopCap: z.coerce.number().int().nonnegative().default(2),
    remediationTimeoutHours: z.coerce.number().int().positive().default(48),
    externalIntegrationMode: z.enum(['mock', 'live', 'skip']).default('mock'),
    automatedTestCommand: z.string().min(1).default('pnpm test'),
    e2eTestCommand: z.string().optional(),
    qaDeployScript: z.string().optional(),
    qaEngineerMaxTurns: z.coerce.number().int().positive().default(40),
    qaEngineerCostCapUsd: z.coerce.number().positive().default(4),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    evalFixtureMode: z.enum(['mock', 'live']).default('mock'),
  }),
  infrastructure: z.object({
    port: z.coerce.number().int().positive().default(3001),
    dbPath: z.string().min(1),
    projectDir: z.string().min(1),
    qaWorkspaceDir: z.string().min(1),
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
  'identity.gitlab.apiUrl': 'GITLAB_API_URL',
  'identity.gitlab.projectId': 'GITLAB_PROJECT_ID',
  'behaviour.pollIntervalMs': 'POLL_INTERVAL_MS',
  'behaviour.qaDefectLoopCap': 'QA_DEFECT_LOOP_CAP',
  'behaviour.remediationTimeoutHours': 'REMEDIATION_TIMEOUT_HOURS',
  'behaviour.externalIntegrationMode': 'EXTERNAL_INTEGRATION_MODE',
  'behaviour.automatedTestCommand': 'AUTOMATED_TEST_COMMAND',
  'behaviour.e2eTestCommand': 'E2E_TEST_COMMAND',
  'behaviour.qaDeployScript': 'QA_DEPLOY_SCRIPT',
  'behaviour.qaEngineerMaxTurns': 'QA_ENGINEER_MAX_TURNS',
  'behaviour.qaEngineerCostCapUsd': 'QA_ENGINEER_COST_CAP_USD',
  'behaviour.logLevel': 'LOG_LEVEL',
  'behaviour.evalFixtureMode': 'CREW_EVAL_FIXTURE_MODE',
  'infrastructure.port': 'PORT',
  'infrastructure.dbPath': 'DB_PATH',
  'infrastructure.projectDir': 'PROJECT_DIR',
  'infrastructure.qaWorkspaceDir': 'QA_WORKSPACE_DIR',
  'secrets.anthropicApiKey': 'ANTHROPIC_API_KEY',
  'secrets.atlassianApiToken': 'ATLASSIAN_API_TOKEN',
  'secrets.gitlabAccessToken': 'GITLAB_PERSONAL_ACCESS_TOKEN',
  'secrets.jiraWebhookSecret': 'JIRA_WEBHOOK_SECRET',
  'secrets.honeycombApiKey': 'HONEYCOMB_API_KEY',
};

/**
 * Read and validate the delivery-qa runtime configuration from environment
 * variables. Called once at process startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
