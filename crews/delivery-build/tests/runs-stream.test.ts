/**
 * RH02-09 — Operator run-stream exposes structured progress for in-flight stories.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createRunStreamBridge,
  createRunStreamHub,
  type RunProgressEvent,
  type RunStreamHub,
} from '@daddia/crew';
import { runsStreamHandler } from '../src/handlers/runs-stream.js';
import type { StateStore } from '../src/state.js';

function makeState(story?: { issueKey: string; currentStep: string }): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi
      .fn()
      .mockReturnValue(
        story
          ? { issueKey: story.issueKey, currentStep: story.currentStep, startedAt: Date.now() }
          : undefined,
      ),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function makeApp(hub: RunStreamHub, state: StateStore): Hono {
  const app = new Hono();
  app.get('/runs/:issueKey/stream', (c) => runsStreamHandler(c, hub, state));
  return app;
}

async function readSseEvents(
  response: Response,
  count: number,
  timeoutMs = 3000,
): Promise<RunProgressEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: RunProgressEvent[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data: ')) continue;
      events.push(JSON.parse(line.slice(6)) as RunProgressEvent);
      if (events.length >= count) break;
    }
  }

  await reader.cancel();
  return events;
}

describe('GET /runs/:issueKey/stream', () => {
  let hub: RunStreamHub;

  beforeEach(() => {
    hub = createRunStreamHub();
  });

  it('returns 404 when the story is not in state', async () => {
    const app = makeApp(hub, makeState());
    const res = await app.request('/runs/CREW-99/stream');
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid issue key', async () => {
    const app = makeApp(hub, makeState());
    const res = await app.request('/runs/bad%20key/stream');
    expect(res.status).toBe(400);
  });

  it('streams tool-use and subagent events in order with issueKey during implement', async () => {
    const issueKey = 'CREW-50-001';
    const parentSessionId = 'sess-parent-123';
    const app = makeApp(hub, makeState({ issueKey, currentStep: 'implement' }));

    const { auditHook, onSubagentAudit } = createRunStreamBridge(
      hub,
      issueKey,
      () => parentSessionId,
      { allowedTools: ['Read'] },
    );

    const streamPromise = app.request(`/runs/${issueKey}/stream`);
    await new Promise((r) => setTimeout(r, 20));

    hub.publish({ type: 'step', issueKey, step: 'implement' });
    auditHook({ tool: 'Read', input: {}, output: 'file contents', durationMs: 8 });
    onSubagentAudit({ phase: 'start', agentType: 'test-runner', agentId: 'sub-sess-456' });

    const res = await streamPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await readSseEvents(res, 3);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.issueKey === issueKey)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['step', 'tool-use', 'subagent']);
    expect(events[0]!.seq).toBeLessThan(events[1]!.seq);
    expect(events[1]!.seq).toBeLessThan(events[2]!.seq);

    const toolEvent = events[1];
    expect(toolEvent?.type).toBe('tool-use');
    if (toolEvent?.type === 'tool-use') {
      expect(toolEvent.parentSessionId).toBe(parentSessionId);
    }

    const subEvent = events[2];
    expect(subEvent?.type).toBe('subagent');
    if (subEvent?.type === 'subagent') {
      expect(subEvent.subagentSessionId).toBe('sub-sess-456');
      expect(subEvent.parentSessionId).toBe(parentSessionId);
    }
  });
});
