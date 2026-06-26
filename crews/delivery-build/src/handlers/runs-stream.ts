import type { Context } from 'hono';
import { formatRunProgressSse, type RunStreamHub } from '@daddia/crew';
import type { StateStore } from '../state.js';

/**
 * GET /runs/:issueKey/stream — Server-Sent Events feed of structured progress
 * for an in-flight story (tool-use, subagent, step transitions).
 */
export function runsStreamHandler(
  c: Context,
  hub: RunStreamHub,
  state: StateStore,
): Response {
  const issueKey = c.req.param('issueKey');
  if (!issueKey || issueKey.length > 64 || !/^[\w-]+$/.test(issueKey)) {
    return c.json({ error: 'Invalid issue key' }, 400);
  }

  const story = state.getStory(issueKey);
  if (!story) {
    return c.json({ error: 'Story not found' }, 404);
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const subscription = hub.subscribe(issueKey);
      let closed = false;

      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream may already be closed by the client.
        }
      };

      unsubscribe = close;

      void (async () => {
        try {
          for await (const event of subscription) {
            if (closed) return;
            controller.enqueue(encoder.encode(formatRunProgressSse(event)));
          }
        } catch {
          close();
        } finally {
          close();
        }
      })();
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
