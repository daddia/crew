import type { Context } from 'hono';
import { verifySignature } from '@daddia/crew/webhooks';
import { log } from '../observability.js';
import type { StateStore } from '../state.js';
import type { WorkflowCtxBase } from '../workflow.js';
import { addressFeedback } from '../workflow.js';
import { has, runStoryWithLock } from '../in-flight.js';

/**
 * Extract a Jira issue key from an MR title.
 * Expects a bracket-prefixed key, e.g. "[ENG-99] Add login endpoint" → "ENG-99".
 */
function extractIssueKey(title: string): string | undefined {
  const match = /^\[([A-Z][A-Z0-9]+-\d+)\]/.exec(title);
  return match?.[1];
}

export async function gitlabHandler(
  c: Context,
  state: StateStore,
  secret: string,
  ctxBase: WorkflowCtxBase,
): Promise<Response> {
  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);

  try {
    verifySignature('gitlab', bodyBuffer, c.req.header(), secret);
  } catch (err) {
    log.warn('gitlab.handler.signature-failed', { err: String(err) });
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = JSON.parse(bodyBuffer.toString('utf8')) as Record<string, unknown>;

  const eventId =
    (c.req.header('x-gitlab-event-uuid') as string | undefined) ??
    String((body['object_attributes'] as Record<string, unknown> | undefined)?.['id'] ?? 'unknown');

  if (state.checkAndRecord('gitlab', eventId)) {
    log.info('gitlab.handler.duplicate', { eventId });
    return c.json({ ok: true, duplicate: true });
  }

  // Only handle note (comment) events on merge requests.
  if (body['object_kind'] !== 'note') {
    log.debug('gitlab.handler.ignored', { eventId, kind: body['object_kind'] });
    return c.json({ ok: true, ignored: true });
  }

  const attrs = body['object_attributes'] as Record<string, unknown> | undefined;
  const mr = body['merge_request'] as Record<string, unknown> | undefined;

  // Ignore system-generated notes (approvals, pipeline updates, etc.).
  if (attrs?.['system'] === true) {
    log.debug('gitlab.handler.system-note-ignored', { eventId });
    return c.json({ ok: true, ignored: true });
  }

  const comment = typeof attrs?.['note'] === 'string' ? attrs['note'] : undefined;
  const mrTitle = typeof mr?.['title'] === 'string' ? mr['title'] : undefined;
  const mrUrl = typeof mr?.['url'] === 'string' ? mr['url'] : undefined;

  if (!comment || !mrTitle || !mrUrl) {
    log.debug('gitlab.handler.incomplete-payload', { eventId });
    return c.json({ ok: true, ignored: true });
  }

  const issueKey = extractIssueKey(mrTitle);
  if (!issueKey) {
    log.debug('gitlab.handler.no-issue-key', { eventId, mrTitle });
    return c.json({ ok: true, ignored: true });
  }

  if (has(issueKey)) {
    log.debug('gitlab.handler.in-flight', { issueKey, eventId });
    return c.json({ error: 'workflow-in-flight', issueKey }, 429);
  }

  runStoryWithLock(
    issueKey,
    () => addressFeedback({ issueKey, state, ...ctxBase }, comment, mrUrl),
    (err) => {
      log.error('gitlab.handler.workflow-error', { issueKey, err: String(err) });
    },
    { deferred: true },
  );

  return c.json({ ok: true });
}
