import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from '../src/config.js';
import { SchemaValidationError } from '@daddia/crew/config';

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  CREW_ID: 'delivery-review-acme',
  ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
  ATLASSIAN_EMAIL: 'bot@acme.example.com',
  JIRA_PROJECT_KEY: 'ACME',
  JIRA_ASSIGNEE_ACCOUNT_ID: '5b10ac8d82e05b22cc7d4ef5',
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_10042',
  PM_APPROVER_ACCOUNT_IDS: '5b10ac8d82e05b22cc7d4ef5,712020:abc-def-ghi',
  GITLAB_API_URL: 'https://gitlab.com/api/v4',
  GITLAB_PROJECT_ID: '12345678',
  DB_PATH: '/data/delivery-review.db',
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ATLASSIAN_API_TOKEN: 'atlassian-api-token',
  GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-token',
  JIRA_WEBHOOK_SECRET: 'jira-webhook-secret-ok',
};

describe('loadConfig – valid config', () => {
  it('returns a fully typed Config from a complete env', () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.identity.crewId).toBe('delivery-review-acme');
    expect(config.infrastructure.port).toBe(3002);
    expect(config.identity.jira.pmApproverAccountIds).toEqual([
      '5b10ac8d82e05b22cc7d4ef5',
      '712020:abc-def-ghi',
    ]);
    expect(config.identity.gitlab.defaultBranch).toBe('main');
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
  it('applies review behaviour defaults', () => {
    const config = loadConfig(REQUIRED_ENV);
    expect(config.behaviour.pollIntervalMs).toBe(300_000);
    expect(config.behaviour.pmReviewTimeoutHours).toBe(48);
    expect(config.behaviour.pmApprovalCommentPattern).toBe('/pm-approve');
    expect(config.behaviour.techLeadMaxTurns).toBe(30);
    expect(config.behaviour.techLeadCostCapUsd).toBe(5);
    expect(config.behaviour.diffFileCap).toBe(50);
    expect(config.behaviour.diffSizeCapBytes).toBe(500_000);
    expect(config.behaviour.evalFixtureMode).toBe('mock');
  });
});

describe('loadConfig – validation errors', () => {
  it('throws SchemaValidationError when PM_APPROVER_ACCOUNT_IDS is missing', () => {
    const { PM_APPROVER_ACCOUNT_IDS: _removed, ...envWithoutPm } = REQUIRED_ENV;
    expect(() => loadConfig(envWithoutPm)).toThrow(SchemaValidationError);
  });

  it('throws SchemaValidationError when PM_APPROVER_ACCOUNT_IDS is empty', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, PM_APPROVER_ACCOUNT_IDS: '' })).toThrow(
      SchemaValidationError,
    );
  });

  it('throws SchemaValidationError when PORT is not a positive integer', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, PORT: 'not-a-port' })).toThrow(
      SchemaValidationError,
    );
  });

  it('throws SchemaValidationError when JIRA_WEBHOOK_SECRET is too short', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, JIRA_WEBHOOK_SECRET: 'tooshort' })).toThrow(
      SchemaValidationError,
    );
  });
});
