import { z } from 'zod';
import { loadEnv, type EnvMapping } from '@daddia/crew/config';

export const CONFIG_SCHEMA_VERSION = 1 as const;

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1).default('{{CREW_ID}}'),
  }),
  behaviour: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_MAPPING: EnvMapping = {
  'identity.crewId': 'CREW_ID',
  'behaviour.logLevel': 'LOG_LEVEL',
};

/** Read and validate crew configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
