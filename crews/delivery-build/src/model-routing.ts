export interface ModelRouting {
  /** Cheaper/faster model for low-complexity tasks (triage, review). */
  lowCost: string;
  /** Strongest model for implementation and remediation tasks. */
  implementation: string;
}

const LOW_COST_TASKS = new Set(['assess-clarification', 'peer-code-review']);

/**
 * Resolve the model identifier for a workflow task from the local routing map.
 * Pro-tier control-plane routing will supersede this at session start when
 * `@daddia/crew/control` lands; until then config is the source of truth.
 */
export function resolveModelForTask(routing: ModelRouting, task: string): string {
  return LOW_COST_TASKS.has(task) ? routing.lowCost : routing.implementation;
}
