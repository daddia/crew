import { initTracing } from '@daddia/crew';
import { SchemaValidationError } from '@daddia/crew/config';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig, CONFIG_SCHEMA_VERSION } from './config.js';
import { log } from './observability.js';
import { createStateStore } from './state.js';

/**
 * HTTP application with routes wired for this crew. Exported for unit tests
 * that exercise handlers without binding a port.
 */
export function createApp(): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true }));
  return app;
}

/**
 * Full application boot sequence. Exported so tests can drive it with a fixture
 * env without spawning a real process.
 */
export async function boot(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      log.error('config.invalid', {
        code: err.code,
        issues: err.issues,
        pid: process.pid,
      });
      process.exit(1);
      return;
    }
    throw err;
  }

  initTracing({
    serviceName: 'delivery-qa',
    honeycombApiKey: config.secrets.honeycombApiKey,
  });

  log.info('config.loaded', {
    crewId: config.identity.crewId,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  });

  const { port, dbPath } = config.infrastructure;

  const state = createStateStore(dbPath);
  const app = createApp();

  const server = serve({ fetch: app.fetch, port }, () => {
    log.info('server.start', { port, db: dbPath });
  });

  function shutdown(): void {
    log.info('server.shutdown');
    server.close(() => {
      state.close();
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void boot();
}
