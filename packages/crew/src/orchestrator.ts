import type { Agent } from './agent.js';
import type { WorkflowPlan } from './workflow/plan.js';

/** Incoming request that an orchestrator analyses to build a plan. */
export interface OrchestratorRequest {
  /** Jira issue key, e.g. "ENG-123". */
  issueKey: string;
  /** Free-form context from the triggering event (ticket content, labels, etc.). */
  context: Record<string, unknown>;
}

/**
 * Named registry of agents available to the orchestrator. The orchestrator
 * selects which agents are needed for a given request and assembles them
 * into WorkflowPlan steps.
 *
 * In deterministic crews the registry is a fixed map defined by the crew.
 * In dynamic crews the orchestrator uses a Claude session to decide which
 * agents from the registry to include and in what order.
 */
export type AgentRegistry = Readonly<Record<string, Agent>>;

/**
 * An orchestrator receives a request and produces a WorkflowPlan for the
 * WorkflowEngine to execute.
 *
 * Implementations may be fully deterministic (returning a hard-coded plan)
 * or fully dynamic (calling resolveSession() and using Claude to reason
 * about which agents, tools, and steps are needed for the request).
 *
 * Either way the plan is executed by the same WorkflowEngine, so the
 * delivery guarantee is identical regardless of how the plan was assembled.
 */
export interface Orchestrator {
  plan(request: OrchestratorRequest, registry: AgentRegistry): Promise<WorkflowPlan>;
}
