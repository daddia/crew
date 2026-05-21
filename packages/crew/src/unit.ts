import type { Agent } from './agent.js';

/** A deployable agent crew (e.g. "delivery"). */
export interface AgentCrew {
  /** Short identifier, matches the folder name under crews/. */
  readonly name: string;
  /** All persona agents this crew exposes. */
  readonly agents: readonly Agent[];
  /** Graceful shutdown hook — close DB connections, flush buffers, etc. */
  shutdown(): Promise<void>;
}
