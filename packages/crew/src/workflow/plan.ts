import type { Agent } from '../agent.js';

/**
 * How the engine responds when a step fails after all retries are exhausted.
 *
 * - 'escalate' — call onEscalate and stop the workflow (default)
 * - 'continue' — log the failure, merge any artefacts, and proceed to the next step
 * - 'stop'     — end the workflow silently without escalating (for intentional
 *                terminal states such as "parked for clarification")
 */
export type FailurePolicy = 'escalate' | 'continue' | 'stop';

/**
 * A single step in a WorkflowPlan.
 *
 * The step's agent may be:
 * - A named crew agent (e.g. `engineer`, `seniorEngineer`)
 * - An inline Agent implementation wrapping complex logic (loops, polls,
 *   integrations) that the crew owns directly. The engine treats it as a
 *   single unit regardless of internal complexity.
 */
export interface WorkflowStep {
  /** Logical name used in state tracking and logs. */
  name: string;
  /**
   * The agent that executes this step. Must satisfy the Agent interface so
   * the engine can call agent.run(input) uniformly.
   */
  agent: Agent;
  /**
   * How many times to retry a failed step before applying onFailure.
   * Each retry is a fresh agent.run() call with the same accumulated context.
   * Default: 0 (no retries).
   */
  maxRetries?: number;
  /** What to do when the step fails after all retries. Default: 'escalate'. */
  onFailure?: FailurePolicy;
}

/**
 * A description of the work to be done for one story. Produced by a crew
 * (deterministic, hand-coded) or by an Orchestrator (dynamic, AI-assembled)
 * and consumed by a WorkflowEngine.
 */
export interface WorkflowPlan {
  issueKey: string;
  steps: WorkflowStep[];
}
