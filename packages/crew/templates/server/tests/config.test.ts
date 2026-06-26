import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from '../src/config.js';
import { SchemaValidationError } from '@daddia/crew/config';

describe('loadConfig – defaults', () => {
  it('returns scaffold defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.identity.crewId).toBe('{{CREW_ID}}');
    expect(config.infrastructure.port).toBe(3000);
    expect(config.infrastructure.dbPath).toBe('./data/{{CREW_NAME}}.db');
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
      PORT: '4000',
      DB_PATH: '/data/{{CREW_NAME}}.db',
    });
    expect(config.infrastructure.port).toBe(4000);
    expect(config.infrastructure.dbPath).toBe('/data/{{CREW_NAME}}.db');
  });

  it('throws SchemaValidationError when PORT is invalid', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(SchemaValidationError);
  });
});
