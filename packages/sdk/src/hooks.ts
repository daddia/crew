import type {
  HookCallback,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

export interface ToolUseEvent {
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export type PostToolUseHandler = (event: ToolUseEvent) => void;

/**
 * Adapt a PostToolUseHandler to the SDK's HookCallback shape so it can be
 * attached to SDKSessionOptions.hooks.PostToolUse. Calls the handler with a
 * normalised ToolUseEvent; if the handler throws (disallowed tool), the error
 * propagates to the SDK subprocess and the tool call is blocked.
 */
export function toSDKHookCallback(handler: PostToolUseHandler): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name === "PostToolUse") {
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
 * Build a PostToolUse hook that logs every tool invocation and enforces
 * the per-agent allowed-tools list. Throws if the agent calls a disallowed tool
 * (belt-and-suspenders on top of the SDK-level allowedTools filter).
 */
export function buildAuditHook(
  allowedTools: string[],
  log: (event: ToolUseEvent) => void,
): PostToolUseHandler {
  const allowed = new Set(allowedTools);
  return (event) => {
    if (!allowed.has(event.tool)) {
      throw new Error(
        `Tool "${event.tool}" is not in the allowed list for this agent`,
      );
    }
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
    this.name = "IterationCapReached";
  }
}
