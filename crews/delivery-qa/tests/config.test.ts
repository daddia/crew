import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from '../src/config.js';
import { SchemaValidationError } from '@daddia/crew/config';

const REQUIRED_ENV: NodeJS.ProcessEnv = {
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

describe('loadConfig – valid config', () => {
  it('returns a fully typed Config from a complete env', () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.identity.crewId).toBe('delivery-qa-acme');
    expect(config.infrastructure.port).toBe(3001);
    expect(config.infrastructure.qaWorkspaceDir).toBe('/workspace/acme/qa');
  });

  it('exports CONFIG_SCHEMA_VERSION = 1', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
  });

  it('ConfigSchema accepts a loaded config', () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('loadConfig – behaviour defaults', () => {
  it('applies QA behaviour defaults', () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.qaDefectLoopCap).toBe(2);
    expect(config.behaviour.remediationTimeoutHours).toBe(48);
    expect(config.behaviour.externalIntegrationMode).toBe('mock');
    expect(config.behaviour.automatedTestCommand).toBe('pnpm test');
    expect(config.behaviour.qaEngineerMaxTurns).toBe(40);
    expect(config.behaviour.qaEngineerCostCapUsd).toBe(4);
  });
});

describe('loadConfig – validation errors', () => {
  it('throws SchemaValidationError when PORT is not a positive integer', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, PORT: 'not-a-port' })).toThrow(SchemaValidationError);
  });

  it('throws SchemaValidationError when JIRA_WEBHOOK_SECRET is too short', () => {
    expect(() =>
      loadConfig({ ...REQUIRED_ENV, JIRA_WEBHOOK_SECRET: 'tooshort' }),
    ).toThrow(SchemaValidationError);
  });
});
