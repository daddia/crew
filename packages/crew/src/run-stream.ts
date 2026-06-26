import { buildAuditHook, type PostToolUseHandler, type SubagentAuditEvent, type SubagentAuditHandler, type ToolUseEvent } from './hooks.js';

/** Shared fields on every run-progress event emitted to operator subscribers. */
export interface RunProgressEnvelope {
  issueKey: string;
  /** Monotonic per-issue sequence — subscribers receive events in seq order. */
  seq: number;
  ts: number;
}

export interface RunStepProgressEvent extends RunProgressEnvelope {
  type: 'step';
  step: string;
  sessionId?: string;
}

export interface RunToolUseProgressEvent extends RunProgressEnvelope {
  type: 'tool-use';
  /** Parent persona session that invoked the tool. */
  parentSessionId: string;
  tool: string;
  durationMs: number;
}

export interface RunSubagentProgressEvent extends RunProgressEnvelope {
  type: 'subagent';
  phase: 'start' | 'stop';
  /** Parent persona session that delegated to the subagent. */
  parentSessionId: string;
  /** Subagent session identifier from the SDK (correlates with audit trail). */
  subagentSessionId: string;
  agentType: string;
  lastMessage?: string;
}

export type RunProgressEvent =
  | RunStepProgressEvent
  | RunToolUseProgressEvent
  | RunSubagentProgressEvent;

export type RunProgressPublishInput =
  | Omit<RunStepProgressEvent, 'seq' | 'ts'>
  | Omit<RunToolUseProgressEvent, 'seq' | 'ts'>
  | Omit<RunSubagentProgressEvent, 'seq' | 'ts'>;

export interface RunStreamHub {
  publish(event: RunProgressPublishInput): void;
  subscribe(issueKey: string): AsyncIterable<RunProgressEvent>;
  closeIssue(issueKey: string): void;
}

interface ChannelSubscription {
  push(event: RunProgressEvent): void;
  close(): void;
}

interface ChannelState {
  seq: number;
  subscribers: Set<ChannelSubscription>;
}

function createChannelSubscription(): ChannelSubscription & {
  iterable: AsyncIterable<RunProgressEvent>;
} {
  const queue: RunProgressEvent[] = [];
  let pending: ((result: IteratorResult<RunProgressEvent>) => void) | null = null;
  let closed = false;

  const push = (event: RunProgressEvent): void => {
    if (closed) return;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve({ value: event, done: false });
      return;
    }
    queue.push(event);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve({ value: undefined as never, done: true });
    }
  };

  const iterable: AsyncIterable<RunProgressEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<RunProgressEvent>> {
          const queued = queue.shift();
          if (queued) {
            return Promise.resolve({ value: queued, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise((resolve) => {
            pending = resolve;
          });
        },
      };
    },
  };

  return { iterable, push, close };
}

/**
 * In-process pub/sub for operator run-stream subscribers. One hub instance per
 * crew process; events are keyed by issueKey and ordered by seq.
 */
export function createRunStreamHub(): RunStreamHub {
  const channels = new Map<string, ChannelState>();

  function channelFor(issueKey: string): ChannelState {
    let ch = channels.get(issueKey);
    if (!ch) {
      ch = { seq: 0, subscribers: new Set() };
      channels.set(issueKey, ch);
    }
    return ch;
  }

  return {
    publish(partial) {
      const ch = channelFor(partial.issueKey);
      const event = { ...partial, seq: ++ch.seq, ts: Date.now() } as RunProgressEvent;
      for (const sub of ch.subscribers) {
        sub.push(event);
      }
    },

    subscribe(issueKey) {
      const sub = createChannelSubscription();
      const ch = channelFor(issueKey);
      ch.subscribers.add(sub);

      const baseIterable = sub.iterable;
      return {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const event of baseIterable) {
              yield event;
            }
          } finally {
            ch.subscribers.delete(sub);
            sub.close();
          }
        },
      };
    },

    closeIssue(issueKey) {
      const ch = channels.get(issueKey);
      if (!ch) return;
      for (const sub of ch.subscribers) {
        sub.close();
      }
      ch.subscribers.clear();
      channels.delete(issueKey);
    },
  };
}

export interface RunStreamBridgeOptions {
  allowedTools: string[];
  /** Extra handler after stream publish (logging, audit collection). */
  onToolUse?: (event: ToolUseEvent) => void;
  onSubagent?: (event: SubagentAuditEvent) => void;
}

/**
 * Wire audit hooks to a {@link RunStreamHub} so tool-use and subagent events
 * reach operator subscribers with parent/subagent session correlation.
 */
export function createRunStreamBridge(
  hub: RunStreamHub,
  issueKey: string,
  getParentSessionId: () => string,
  options: RunStreamBridgeOptions,
): { auditHook: PostToolUseHandler; onSubagentAudit: SubagentAuditHandler } {
  const auditHook = buildAuditHook(options.allowedTools, (event) => {
    hub.publish({
      type: 'tool-use',
      issueKey,
      parentSessionId: getParentSessionId(),
      tool: event.tool,
      durationMs: event.durationMs,
    });
    options.onToolUse?.(event);
  });

  const onSubagentAudit: SubagentAuditHandler = (event) => {
    hub.publish({
      type: 'subagent',
      issueKey,
      phase: event.phase,
      parentSessionId: getParentSessionId(),
      subagentSessionId: event.agentId,
      agentType: event.agentType,
      ...(event.lastMessage !== undefined ? { lastMessage: event.lastMessage } : {}),
    });
    options.onSubagent?.(event);
  };

  return { auditHook, onSubagentAudit };
}

/** Format a run-progress event as a Server-Sent Events frame. */
export function formatRunProgressSse(event: RunProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
