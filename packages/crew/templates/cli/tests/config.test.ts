import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, CONFIG_SCHEMA_VERSION } from '../src/config.js';

describe('loadConfig – defaults', () => {
  it('returns scaffold defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.identity.crewId).toBe('{{CREW_ID}}');
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
