import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { jiraHandler } from "./handlers/jira.js";
import { gitlabHandler } from "./handlers/gitlab.js";
import { log } from "./observability.js";
import { startPoller } from "./poller.js";
import { createStateStore } from "./state.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const DB_PATH = process.env["DB_PATH"] ?? "./data/delivery-build.db";

const state = createStateStore(DB_PATH);

const app = new Hono();

app.post("/webhooks/jira", (c) => jiraHandler(c, state));
app.post("/webhooks/gitlab", (c) => gitlabHandler(c, state));

app.get("/healthz", (c) => c.json({ ok: true }));

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  log.info("server.start", { port: PORT, db: DB_PATH });
});

const pollInterval = startPoller(state);

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
