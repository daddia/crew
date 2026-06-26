import { initTracing } from '@daddia/crew';
import { SchemaValidationError } from '@daddia/crew/config';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig, CONFIG_SCHEMA_VERSION } from './config.js';
import { log } from './observability.js';
import { createStateStore } from './state.js';

/** Boot the Hono server. Exported for tests. */
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

  initTracing({ serviceName: '{{CREW_NAME}}' });

  log.info('config.loaded', {
    crewId: config.identity.crewId,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  });

  const { port, dbPath } = config.infrastructure;
  const state = createStateStore(dbPath);

  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true }));

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
