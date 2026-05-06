import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { log } from "./observability.js";
import { createStateStore } from "./state.js";

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const DB_PATH = process.env["DB_PATH"] ?? "./data/delivery-review.db";

// State is initialised eagerly so the DB file is created and WAL mode is set
// before the first request. Once webhook handlers are wired they will receive
// this store; the reference is also needed for graceful shutdown.
const state = createStateStore(DB_PATH);

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

// TODO: add webhook handler for `ready-for-review` event from delivery-build.

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  log.info("server.start", { port: PORT, db: DB_PATH });
});

// Graceful shutdown
function shutdown(): void {
  log.info("server.shutdown");
  server.close(() => {
    state.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
