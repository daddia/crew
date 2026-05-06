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
import { loadConfig } from "./config.js";
import type { WorkflowCtxBase } from "./workflow.js";

const config = loadConfig();

const jira = createJiraClient(config.identity.jira, {
  atlassianApiToken: config.secrets.atlassianApiToken,
});
const gitlab = createGitlabClient(config.identity.gitlab, {
  gitlabAccessToken: config.secrets.gitlabAccessToken,
});

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
  jiraHandler(c, state, String(config.secrets.jiraWebhookSecret), ctxBase),
);
app.post("/webhooks/gitlab", (c) =>
  gitlabHandler(c, state, String(config.secrets.gitlabWebhookSecret), ctxBase),
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

// Graceful shutdown
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
