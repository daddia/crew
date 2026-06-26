import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { initTracing } from '@daddia/crew';
import { createEvalFetchHandler } from '@daddia/crew/evals';
import { SchemaValidationError, redact } from '@daddia/crew/config';
import { createEvalFixtures } from './eval/fixtures.js';
import { jiraHandler } from './handlers/jira.js';
import { createJiraClient } from './integrations/jira.js';
import { createGitlabClient } from './integrations/gitlab.js';
import { loadConfig, CONFIG_SCHEMA_VERSION, type Config } from './config.js';
import { log } from './observability.js';
import { startPoller } from './poller.js';
import { createStateStore } from './state.js';
import { recoverInterruptedSteps, type WorkflowCtxBase } from './workflow.js';

/**
 * HTTP application with routes wired for this crew. Exported for unit tests
 * that exercise handlers without binding a port.
 */
export function createApp(
  state: ReturnType<typeof createStateStore>,
  config: Config,
  ctxBase: WorkflowCtxBase,
): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.post('/webhooks/jira', (c) =>
    jiraHandler(c, state, config.secrets.jiraWebhookSecret, ctxBase),
  );

  const evalHandler = createEvalFetchHandler({
    fixtures: createEvalFixtures(config.behaviour.evalFixtureMode),
  });
  app.all('/eval/*', (c) => evalHandler(c.req.raw));

  return app;
}

/**
 * Full application boot sequence. Exported so tests can drive it with a fixture
 * env without spawning a real process.
 */
export async function boot(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let config: Config;

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
    ...redact(config),
  });

  const jira = createJiraClient(config.identity.jira, {
    atlassianApiToken: config.secrets.atlassianApiToken,
  });
  const gitlab = createGitlabClient(config.identity.gitlab, {
    gitlabAccessToken: config.secrets.gitlabAccessToken,
  });

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      qaDefectLoopCap: config.behaviour.qaDefectLoopCap,
      remediationTimeoutHours: config.behaviour.remediationTimeoutHours,
      externalIntegrationMode: config.behaviour.externalIntegrationMode,
      automatedTestCommand: config.behaviour.automatedTestCommand,
      e2eTestCommand: config.behaviour.e2eTestCommand,
      qaDeployScript: config.behaviour.qaDeployScript,
      qaEngineerMaxTurns: config.behaviour.qaEngineerMaxTurns,
      qaEngineerCostCapUsd: config.behaviour.qaEngineerCostCapUsd,
    },
    jira,
    gitlab,
    qaWorkspaceDir: config.infrastructure.qaWorkspaceDir,
  };

  const state = createStateStore(config.infrastructure.dbPath);

  await recoverInterruptedSteps(state, ctxBase);

  const app = createApp(state, config, ctxBase);

  const server = serve({ fetch: app.fetch, port: config.infrastructure.port }, () => {
    log.info('server.start', {
      port: config.infrastructure.port,
      db: config.infrastructure.dbPath,
    });
  });

  const pollerDeps = {
    identity: config.identity,
    behaviour: config.behaviour,
    jira,
    gitlab,
    qaWorkspaceDir: config.infrastructure.qaWorkspaceDir,
  };

  const pollInterval = startPoller(pollerDeps, state);

  function shutdown(): void {
    log.info('server.shutdown');
    clearInterval(pollInterval);
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
