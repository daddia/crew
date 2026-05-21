import type { Agent } from './agent.js';
import type { Orchestrator } from './orchestrator.js';

/** A deployable agent crew (e.g. "delivery-build"). */
export interface AgentCrew {
  /** Short identifier, matches the folder name under crews/. */
  readonly name: string;
  /** All persona agents this crew exposes. */
  readonly agents: readonly Agent[];
  /**
   * Optional orchestrator that builds a WorkflowPlan dynamically from an
   * incoming request. When absent the crew uses a deterministic fixed plan.
   */
  readonly orchestrator?: Orchestrator;
  /** Graceful shutdown — close DB connections, flush buffers, etc. */
  shutdown(): Promise<void>;
}
