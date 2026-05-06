import type { Context } from "hono";
import { checkReplayWindow, verifySignature } from "@daddia/crew/webhooks";
import { getIdempotency } from "../idempotency.js";
import { log } from "../observability.js";
import type { StateStore } from "../state.js";
import { runStory } from "../workflow.js";

export async function jiraHandler(
  c: Context,
  state: StateStore,
): Promise<Response> {
  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);

  // Read lazily so tests can set the env var before the first request.
  const secret = process.env["JIRA_WEBHOOK_SECRET"] ?? "";

  // 1. Verify HMAC signature.
  try {
    verifySignature("jira", bodyBuffer, c.req.header(), secret);
  } catch (err) {
    log.warn("jira.handler.signature-failed", { err: String(err) });
    return c.json({ error: "Forbidden" }, 403);
  }

  const body: unknown = JSON.parse(bodyBuffer.toString("utf8"));
  if (!isJiraEvent(body)) {
    return c.json({ error: "Unrecognised payload" }, 400);
  }

  // 2. Timestamp replay window.
  try {
    checkReplayWindow({ timestampMs: body.timestamp });
  } catch (err) {
    log.warn("jira.handler.replay-rejected", { err: String(err) });
    return c.json({ error: "Replay rejected" }, 400);
  }

  // 3. Idempotency — skip if we've seen this event.
  const eventId = String(body.id);
  if (getIdempotency().checkAndRecord("jira", eventId)) {
    log.info("jira.handler.duplicate", { eventId });
    return c.json({ ok: true, duplicate: true });
  }

  // 4. Filter to "Ready for Dev" transitions only.
  const transition = body.transition;
  if (transition?.transitionName !== "Ready for Dev") {
    return c.json({ ok: true, ignored: true });
  }

  const issueKey = body.issue?.key;
  if (!issueKey) {
    return c.json({ error: "Missing issue key" }, 400);
  }

  log.info("jira.handler.dispatch", { issueKey, eventId });

  // Fire-and-forget — webhook must return quickly.
  setImmediate(() => {
    runStory({ issueKey, state }).catch((err) => {
      log.error("jira.handler.workflow-error", { issueKey, err: String(err) });
    });
  });

  return c.json({ ok: true });
}

interface JiraEvent {
  id: number;
  timestamp: number;
  transition?: { transitionName?: string };
  issue?: { key?: string };
}

function isJiraEvent(v: unknown): v is JiraEvent {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    "timestamp" in v
  );
}
