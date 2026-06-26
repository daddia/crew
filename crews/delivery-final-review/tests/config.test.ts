import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from '../src/config.js';
import { SchemaValidationError } from '@daddia/crew/config';

describe('loadConfig – defaults', () => {
  it('returns scaffold defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.identity.crewId).toBe('delivery-final-review');
    expect(config.infrastructure.port).toBe(3001);
    expect(config.infrastructure.dbPath).toBe('./data/delivery-review.db');
    expect(config.behaviour.logLevel).toBe('info');
  });

  it('exports CONFIG_SCHEMA_VERSION = 1', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
  });

  it('ConfigSchema accepts a loaded config', () => {
    const config = loadConfig({});
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('loadConfig – overrides', () => {
  it('reads PORT and DB_PATH from the environment', () => {
    const config = loadConfig({
      PORT: '4001',
      DB_PATH: '/data/review.db',
      CREW_ID: 'delivery-final-review-staging',
    });
    expect(config.infrastructure.port).toBe(4001);
    expect(config.infrastructure.dbPath).toBe('/data/review.db');
    expect(config.identity.crewId).toBe('delivery-final-review-staging');
  });

  it('throws SchemaValidationError when PORT is not a positive integer', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(SchemaValidationError);
  });
});
