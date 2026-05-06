import type { Context } from "hono";
import { verifySignature } from "@daddia/crew/webhooks";
import { getIdempotency } from "../idempotency.js";
import { log } from "../observability.js";
import type { StateStore } from "../state.js";
import { addressFeedback } from "../workflow.js";

export async function gitlabHandler(
  c: Context,
  state: StateStore,
): Promise<Response> {
  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);

  // Read lazily so tests can set the env var before the first request.
  const secret = process.env["GITLAB_WEBHOOK_SECRET"] ?? "";

  // 1. Verify token.
  try {
    verifySignature("gitlab", bodyBuffer, c.req.header(), secret);
  } catch (err) {
    log.warn("gitlab.handler.signature-failed", { err: String(err) });
    return c.json({ error: "Forbidden" }, 403);
  }

  const body: unknown = JSON.parse(bodyBuffer.toString("utf8"));
  if (!isGitLabNoteEvent(body)) {
    return c.json({ ok: true, ignored: true });
  }

  // 2. Replay protection — GitLab does not include a delivery timestamp in the
  //    request body, so checkReplayWindow() cannot be applied here (it requires
  //    a millisecond timestamp to compare against the current time). Duplicate
  //    delivery is instead handled by the idempotency store below, which rejects
  //    any event whose (provider, eventId) pair has already been processed.
  const eventId =
    (c.req.header("x-gitlab-event-uuid") as string | undefined) ??
    String(body.object_attributes.id);

  if (getIdempotency().checkAndRecord("gitlab", eventId)) {
    log.info("gitlab.handler.duplicate", { eventId });
    return c.json({ ok: true, duplicate: true });
  }

  // 3. Only act on human (non-bot) note events on open MRs.
  if (body.object_attributes.system) {
    return c.json({ ok: true, ignored: true });
  }

  // Extract issueKey from MR description or title — convention: "[ENG-123]" prefix.
  const mrTitle: string = body.merge_request?.title ?? "";
  const match = mrTitle.match(/\[([A-Z]+-\d+)\]/);
  if (!match) {
    log.warn("gitlab.handler.no-issue-key", { mrTitle });
    return c.json({ ok: true, ignored: true });
  }

  const issueKey = match[1] as string;
  const comment: string = body.object_attributes.note;
  const mrUrl: string = body.merge_request?.url ?? "";

  log.info("gitlab.handler.dispatch", { issueKey, eventId });

  setImmediate(() => {
    addressFeedback({ issueKey, state }, comment, mrUrl).catch((err) => {
      log.error("gitlab.handler.workflow-error", { issueKey, err: String(err) });
    });
  });

  return c.json({ ok: true });
}

interface GitLabNoteEvent {
  object_kind: "note";
  object_attributes: {
    id: number;
    note: string;
    system: boolean;
  };
  merge_request?: {
    title?: string;
    url?: string;
  };
}

function isGitLabNoteEvent(v: unknown): v is GitLabNoteEvent {
  return (
    typeof v === "object" &&
    v !== null &&
    "object_kind" in v &&
    (v as Record<string, unknown>)["object_kind"] === "note" &&
    "object_attributes" in v
  );
}
