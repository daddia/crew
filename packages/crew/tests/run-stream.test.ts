import { describe, it, expect, vi } from 'vitest';
import {
  createRunStreamHub,
  createRunStreamBridge,
  formatRunProgressSse,
  type RunProgressEvent,
} from '../src/run-stream.js';

async function collectEvents(
  hub: ReturnType<typeof createRunStreamHub>,
  issueKey: string,
  count: number,
): Promise<RunProgressEvent[]> {
  const events: RunProgressEvent[] = [];
  for await (const event of hub.subscribe(issueKey)) {
    events.push(event);
    if (events.length >= count) break;
  }
  return events;
}

describe('createRunStreamHub', () => {
  it('delivers events in seq order for an issueKey', async () => {
    const hub = createRunStreamHub();
    const issueKey = 'CREW-99';

    const collectPromise = collectEvents(hub, issueKey, 2);

    hub.publish({ type: 'step', issueKey, step: 'implement' });
    hub.publish({
      type: 'tool-use',
      issueKey,
      parentSessionId: 'parent-sess',
      tool: 'Read',
      durationMs: 12,
    });

    const events = await collectPromise;
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('step');
    expect(events[0]?.issueKey).toBe(issueKey);
    expect(events[0]?.seq).toBe(1);
    expect(events[1]?.type).toBe('tool-use');
    expect(events[1]?.issueKey).toBe(issueKey);
    expect(events[1]?.seq).toBe(2);
    expect(events[1]!.seq).toBeGreaterThan(events[0]!.seq);
  });

  it('isolates channels by issueKey', async () => {
    const hub = createRunStreamHub();
    const collectA = collectEvents(hub, 'CREW-A', 1);
    const collectB = collectEvents(hub, 'CREW-B', 1);

    hub.publish({ type: 'step', issueKey: 'CREW-A', step: 'implement' });
    hub.publish({ type: 'step', issueKey: 'CREW-B', step: 'peer-review' });

    const [eventsA, eventsB] = await Promise.all([collectA, collectB]);
    expect(eventsA[0]?.issueKey).toBe('CREW-A');
    expect(eventsB[0]?.issueKey).toBe('CREW-B');
  });
});

describe('createRunStreamBridge', () => {
  it('publishes tool-use and subagent events with parent session correlation', async () => {
    const hub = createRunStreamHub();
    const issueKey = 'CREW-50-001';
    const parentSessionId = 'sess-parent-abc';
    const getParentSessionId = vi.fn().mockReturnValue(parentSessionId);

    const { auditHook, onSubagentAudit } = createRunStreamBridge(
      hub,
      issueKey,
      getParentSessionId,
      { allowedTools: ['Read'] },
    );

    const collectPromise = collectEvents(hub, issueKey, 3);

    auditHook({ tool: 'Read', input: {}, output: 'ok', durationMs: 5 });
    onSubagentAudit({ phase: 'start', agentType: 'test-runner', agentId: 'sub-sess-1' });
    onSubagentAudit({
      phase: 'stop',
      agentType: 'test-runner',
      agentId: 'sub-sess-1',
      lastMessage: 'done',
    });

    const events = await collectPromise;
    expect(events.map((e) => e.type)).toEqual(['tool-use', 'subagent', 'subagent']);

    const toolEvent = events[0];
    expect(toolEvent?.type).toBe('tool-use');
    if (toolEvent?.type === 'tool-use') {
      expect(toolEvent.parentSessionId).toBe(parentSessionId);
      expect(toolEvent.tool).toBe('Read');
    }

    const startEvent = events[1];
    expect(startEvent?.type).toBe('subagent');
    if (startEvent?.type === 'subagent') {
      expect(startEvent.phase).toBe('start');
      expect(startEvent.parentSessionId).toBe(parentSessionId);
      expect(startEvent.subagentSessionId).toBe('sub-sess-1');
    }

    expect(getParentSessionId).toHaveBeenCalled();
  });
});

describe('formatRunProgressSse', () => {
  it('serialises an event as an SSE data frame', () => {
    const frame = formatRunProgressSse({
      type: 'step',
      issueKey: 'CREW-1',
      seq: 1,
      ts: 1000,
      step: 'implement',
    });
    expect(frame).toBe(
      'data: {"type":"step","issueKey":"CREW-1","seq":1,"ts":1000,"step":"implement"}\n\n',
    );
  });
});
