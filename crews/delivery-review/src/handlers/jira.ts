import type { Context } from 'hono';
import { checkReplayWindow, verifySignature } from '@daddia/crew/webhooks';
import { log } from '../observability.js';
import type { StateStore } from '../state.js';
import { runReviewWorkflow, type WorkflowCtxBase } from '../workflow.js';
import { has, runReviewWorkflowWithLock } from '../in-flight.js';

export async function jiraHandler(
  c: Context,
  state: StateStore,
  secret: string,
  ctxBase: WorkflowCtxBase,
): Promise<Response> {
  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);

  try {
    verifySignature('jira', bodyBuffer, c.req.header(), secret);
  } catch (err) {
    log.warn('jira.handler.signature-failed', { err: String(err) });
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body: unknown = JSON.parse(bodyBuffer.toString('utf8'));
  if (!isJiraEvent(body)) {
    return c.json({ error: 'Unrecognised payload' }, 400);
  }

  try {
    checkReplayWindow({ timestampMs: body.timestamp });
  } catch (err) {
    log.warn('jira.handler.replay-rejected', { err: String(err) });
    return c.json({ error: 'Replay rejected' }, 400);
  }

  const eventId = String(body.id);
  if (state.checkAndRecord('jira', eventId)) {
    log.info('jira.handler.duplicate', { eventId });
    return c.json({ ok: true, duplicate: true });
  }

  const transition = body.transition;
  if (transition?.transitionName !== 'In Review') {
    return c.json({ ok: true, ignored: true });
  }

  const issueKey = body.issue?.key;
  if (!issueKey) {
    return c.json({ error: 'Missing issue key' }, 400);
  }

  if (has(issueKey)) {
    log.info('jira.handler.in-flight', { issueKey });
    return c.json({ error: 'workflow-in-flight', issueKey }, 429);
  }

  log.info('jira.handler.dispatch', { issueKey, eventId });

  runReviewWorkflowWithLock(
    issueKey,
    () => runReviewWorkflow({ issueKey, state, ...ctxBase }),
    (err) => {
      log.error('jira.handler.workflow-error', { issueKey, err: String(err) });
    },
    { deferred: true },
  );

  return c.json({ ok: true });
}

interface JiraEvent {
  id: number;
  timestamp: number;
  transition?: { transitionName?: string };
  issue?: { key?: string };
}

function isJiraEvent(v: unknown): v is JiraEvent {
  return typeof v === 'object' && v !== null && 'id' in v && 'timestamp' in v;
}
