import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { jiraHandler } from "./handlers/jira.js";
import { gitlabHandler } from "./handlers/gitlab.js";
import { createJiraClient } from "./integrations/jira.js";
import { createGitlabClient } from "./integrations/gitlab.js";
import { log } from "./observability.js";
import { startPoller } from "./poller.js";
import { createStateStore } from "./state.js";
import { recoverInterruptedSteps } from "./workflow.js";
import { loadConfig, CONFIG_SCHEMA_VERSION, type Config } from "./config.js";
import { SchemaValidationError, ConfigNotFoundError, redact } from "@daddia/crew/config";
import type { WorkflowCtxBase } from "./workflow.js";

/**
 * Full application boot sequence. Exported so integration tests can drive it
 * with a fixture env without spawning a real process. In production this is
 * called immediately at the bottom of this module with `process.env`.
 */
export async function boot(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let config: Config;

  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      log.error("config.invalid", {
        code: err.code,
        issues: err.issues,
        pid: process.pid,
      });
      process.exit(1);
      return;
    }
    if (err instanceof ConfigNotFoundError) {
      log.error("config.invalid", {
        code: err.code,
        issues: [{ path: "", message: err.message }],
        pid: process.pid,
      });
      process.exit(1);
      return;
    }
    throw err;
  }

  // initTracing is not exported by all published builds of @daddia/crew.
  // Skip gracefully when absent rather than crashing at boot.
  const crewPkg = await import("@daddia/crew") as Record<string, unknown>;
  const initTracing = crewPkg["initTracing"];
  if (typeof initTracing === "function") {
    (initTracing as (o: { serviceName: string; honeycombApiKey?: unknown }) => void)({
      serviceName: "delivery-build",
      honeycombApiKey: config.secrets.honeycombApiKey,
    });
  }

  const gitSha =
    env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_SHA ?? "unknown";

  log.info("config.loaded", {
    crewId: config.identity.crewId,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    gitSha,
    ...redact(config),
  });

  const jira = createJiraClient(config.identity.jira, {
    atlassianApiToken: config.secrets.atlassianApiToken,
  });
  const gitlab = createGitlabClient(
    config.identity.gitlab,
    { gitlabAccessToken: config.secrets.gitlabAccessToken },
    {
      diffFileCap: config.behaviour.diffFileCap,
      diffSizeCapBytes: config.behaviour.diffSizeCapBytes,
    },
  );

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      refactorLoopCap: config.behaviour.refactorLoopCap,
      ciRetryCap: config.behaviour.ciRetryCap,
      ciPollIntervalMs: config.behaviour.ciPollIntervalMs,
      anthropicModel: config.behaviour.anthropicModel,
    },
    jira,
    gitlab,
    projectDir: config.infrastructure.projectDir,
  };

  const state = createStateStore(config.infrastructure.dbPath);

  await recoverInterruptedSteps(state, ctxBase);

  const app = new Hono();

  app.post("/webhooks/jira", (c) =>
    jiraHandler(c, state, config.secrets.jiraWebhookSecret, ctxBase),
  );
  app.post("/webhooks/gitlab", (c) =>
    gitlabHandler(c, state, config.secrets.gitlabWebhookSecret, ctxBase),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  const server = serve(
    { fetch: app.fetch, port: config.infrastructure.port },
    () => {
      log.info("server.start", {
        port: config.infrastructure.port,
        db: config.infrastructure.dbPath,
      });
    },
  );

  const pollerDeps = {
    identity: config.identity,
    behaviour: config.behaviour,
    jira,
    gitlab,
    projectDir: config.infrastructure.projectDir,
  };

  const pollInterval = startPoller(pollerDeps, state);

  function shutdown(): void {
    log.info("server.shutdown");
    clearInterval(pollInterval);
    server.close(() => {
      state.close();
      process.exit(0);
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Execute boot only when this file is the direct entry point. When imported
// as a module (e.g. by integration tests), the caller drives boot() itself.
// pathToFileURL normalises the argv path so the comparison is portable across
// platforms and handles symlinks / spaces in directory names correctly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  boot();
}
