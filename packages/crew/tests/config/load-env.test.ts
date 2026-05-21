import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '../../src/config/load-env.js';
import { SchemaValidationError } from '../../src/config/errors.js';
import { Secret } from '../../src/config/redact.js';

const schema = z.object({
  identity: z.object({
    jira: z.object({
      projectKey: z.string().min(1),
      assigneeAccountId: z.string().min(1),
    }),
  }),
  behaviour: z.object({
    pollIntervalMs: z.coerce.number().int().positive().default(300_000),
  }),
  secrets: z.object({
    webhookSecret: Secret(z.string().min(16)),
  }),
});

const mapping = {
  'identity.jira.projectKey': 'JIRA_PROJECT_KEY',
  'identity.jira.assigneeAccountId': 'JIRA_ASSIGNEE',
  'behaviour.pollIntervalMs': 'POLL_INTERVAL_MS',
  'secrets.webhookSecret': 'JIRA_WEBHOOK_SECRET',
};

const validEnv: NodeJS.ProcessEnv = {
  JIRA_PROJECT_KEY: 'CREW',
  JIRA_ASSIGNEE: 'abc123',
  JIRA_WEBHOOK_SECRET: 'sixteen-chars-ok',
};

describe('loadEnv – happy path', () => {
  it('maps env vars to the correct schema paths and returns typed result', () => {
    const config = loadEnv(validEnv, schema, mapping);
    expect(config.identity.jira.projectKey).toBe('CREW');
    expect(config.identity.jira.assigneeAccountId).toBe('abc123');
  });

  it('coerces numeric strings to numbers', () => {
    const config = loadEnv({ ...validEnv, POLL_INTERVAL_MS: '60000' }, schema, mapping);
    expect(config.behaviour.pollIntervalMs).toBe(60000);
    expect(typeof config.behaviour.pollIntervalMs).toBe('number');
  });

  it('applies schema defaults when optional env var is absent', () => {
    const config = loadEnv(validEnv, schema, mapping);
    expect(config.behaviour.pollIntervalMs).toBe(300_000);
  });

  it('handles deeply nested mappings correctly', () => {
    const config = loadEnv(validEnv, schema, mapping);
    expect(config.identity.jira).toBeDefined();
    expect(config.identity.jira.projectKey).toBe('CREW');
  });
});

describe('loadEnv – validation errors', () => {
  it('throws SchemaValidationError when a required field is missing', () => {
    const env = { JIRA_ASSIGNEE: 'abc123', JIRA_WEBHOOK_SECRET: 'sixteen-chars-ok' };
    expect(() => loadEnv(env, schema, mapping)).toThrow(SchemaValidationError);
  });

  it('includes the failing field path in the issues array', () => {
    const env = { JIRA_ASSIGNEE: 'abc123', JIRA_WEBHOOK_SECRET: 'sixteen-chars-ok' };
    let err: SchemaValidationError | null = null;
    try {
      loadEnv(env, schema, mapping);
    } catch (e) {
      err = e as SchemaValidationError;
    }
    expect(err).not.toBeNull();
    expect(err!.code).toBe('SCHEMA_VALIDATION');
    const paths = err!.issues.map((i) => i.path);
    expect(paths.some((p) => p.includes('projectKey'))).toBe(true);
  });

  it('throws SchemaValidationError when a coercible value is invalid', () => {
    expect(() =>
      loadEnv({ ...validEnv, POLL_INTERVAL_MS: 'not-a-number' }, schema, mapping),
    ).toThrow(SchemaValidationError);
  });

  it('throws SchemaValidationError when a Secret field fails its inner constraint', () => {
    const env = { ...validEnv, JIRA_WEBHOOK_SECRET: 'tooshort' };
    expect(() => loadEnv(env, schema, mapping)).toThrow(SchemaValidationError);
  });
});

describe('loadEnv – multiple missing fields', () => {
  it('reports all missing fields in a single error', () => {
    let err: SchemaValidationError | null = null;
    try {
      loadEnv({}, schema, mapping);
    } catch (e) {
      err = e as SchemaValidationError;
    }
    expect(err).not.toBeNull();
    expect(err!.issues.length).toBeGreaterThanOrEqual(2);
  });
});
