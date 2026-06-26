import type {
  CanUseTool,
  HookCallback,
  HookInput,
  HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

export interface ToolUseEvent {
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export type PostToolUseHandler = (event: ToolUseEvent) => void;

export interface ToolDenialEvent {
  tool: string;
  input: unknown;
  reason: string;
}

export type ToolDenialHandler = (event: ToolDenialEvent) => void;

export interface SubagentAuditEvent {
  phase: 'start' | 'stop';
  agentType: string;
  agentId: string;
  lastMessage?: string;
}

export type SubagentAuditHandler = (event: SubagentAuditEvent) => void;

/**
 * Adapt a PostToolUseHandler to the SDK's HookCallback shape so it can be
 * attached to SDKSessionOptions.hooks.PostToolUse. Calls the handler with a
 * normalised ToolUseEvent for audit logging after a tool completes.
 */
export function toSDKSubagentAuditCallback(handler: SubagentAuditHandler): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name === 'SubagentStart') {
      handler({
        phase: 'start',
        agentType: input.agent_type,
        agentId: input.agent_id,
      });
    } else if (input.hook_event_name === 'SubagentStop') {
      handler({
        phase: 'stop',
        agentType: input.agent_type,
        agentId: input.agent_id,
        lastMessage: input.last_assistant_message,
      });
    }
    return {};
  };
}

export function toSDKHookCallback(handler: PostToolUseHandler): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name === 'PostToolUse') {
      handler({
        tool: input.tool_name,
        input: input.tool_input,
        output: input.tool_response,
        durationMs: input.duration_ms ?? 0,
      });
    }
    return {};
  };
}

/**
 * Build a canUseTool callback that denies tool calls outside the per-agent
 * allowlist before execution. Invokes onDeny for audit logging when a call
 * is blocked.
 */
export function buildToolAllowlistGuard(
  allowedTools: string[],
  onDeny?: ToolDenialHandler,
): CanUseTool {
  const allowed = new Set(allowedTools);
  return async (toolName, input) => {
    if (!allowed.has(toolName)) {
      const reason = `Tool "${toolName}" is not in the allowed list for this agent`;
      onDeny?.({ tool: toolName, input, reason });
      return { behavior: 'deny', message: reason };
    }
    return { behavior: 'allow' };
  };
}

/**
 * Build a PostToolUse hook that logs every completed tool invocation.
 * Allowlist enforcement is handled by {@link buildToolAllowlistGuard} at the
 * pre-execution boundary; this hook is audit-only.
 */
export function buildAuditHook(
  logOrAllowedTools: ((event: ToolUseEvent) => void) | string[],
  maybeLog?: (event: ToolUseEvent) => void,
): PostToolUseHandler {
  const log =
    typeof logOrAllowedTools === 'function' ? logOrAllowedTools : (maybeLog ?? (() => {}));
  return (event) => {
    log(event);
  };
}

/**
 * Guard that throws when the iteration count reaches the cap.
 * Intended to wrap the agent run loop so the caller never needs to track
 * iteration counts manually.
 */
export function boundedIterGuard(cap: number): (iteration: number) => void {
  return (iteration) => {
    if (iteration >= cap) {
      throw new IterationCapReached(cap);
    }
  };
}

export class IterationCapReached extends Error {
  readonly cap: number;
  constructor(cap: number) {
    super(`Agent iteration cap of ${cap} reached`);
    this.cap = cap;
    this.name = 'IterationCapReached';
  }
}
