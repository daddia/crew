import type { Agent } from "./agent.js";

/** A deployable agent unit (e.g. "delivery"). */
export interface AgentUnit {
  /** Short identifier, matches the folder name under agents/. */
  readonly name: string;
  /** All persona agents this unit exposes. */
  readonly agents: readonly Agent[];
  /** Graceful shutdown hook — close DB connections, flush buffers, etc. */
  shutdown(): Promise<void>;
}
