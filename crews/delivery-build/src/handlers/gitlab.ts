import type { Context } from "hono";
import { verifySignature } from "@daddia/crew/webhooks";
import { log } from "../observability.js";
import type { StateStore } from "../state.js";

export async function gitlabHandler(
  c: Context,
  state: StateStore,
  secret: string,
): Promise<Response> {
  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);

  try {
    verifySignature("gitlab", bodyBuffer, c.req.header(), secret);
  } catch (err) {
    log.warn("gitlab.handler.signature-failed", { err: String(err) });
    return c.json({ error: "Forbidden" }, 403);
  }

  const body: unknown = JSON.parse(bodyBuffer.toString("utf8"));

  // Replay protection — deduplicate by event UUID before any further work.
  const eventId =
    (c.req.header("x-gitlab-event-uuid") as string | undefined) ??
    String((body as Record<string, unknown>)["object_attributes"]
      ? ((body as Record<string, { id?: number }>)["object_attributes"]?.id ?? "unknown")
      : "unknown");

  if (state.checkAndRecord("gitlab", eventId)) {
    log.info("gitlab.handler.duplicate", { eventId });
    return c.json({ ok: true, duplicate: true });
  }

  // MR note events (reviewer comments) are handled by the delivery-code-review
  // crew, not this crew. Acknowledge receipt and ignore.
  log.debug("gitlab.handler.ignored", { eventId });
  return c.json({ ok: true, ignored: true });
}
