import { z } from 'zod';
import { loadEnv, type EnvMapping } from '@daddia/crew/config';

export const CONFIG_SCHEMA_VERSION = 1 as const;

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1).default('delivery-final-review'),
  }),
  behaviour: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
  infrastructure: z.object({
    port: z.coerce.number().int().positive().default(3002),
    dbPath: z.string().min(1).default('./data/delivery-review.db'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_MAPPING: EnvMapping = {
  'identity.crewId': 'CREW_ID',
  'behaviour.logLevel': 'LOG_LEVEL',
  'infrastructure.port': 'PORT',
  'infrastructure.dbPath': 'DB_PATH',
};

/**
 * Read and validate the delivery-final-review runtime configuration from
 * environment variables. Called once at process startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadEnv(env, ConfigSchema, ENV_MAPPING);
}
