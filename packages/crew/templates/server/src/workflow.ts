import { createWorkflowEngine } from '@daddia/crew/workflow';
import type { WorkflowPlan } from '@daddia/crew/workflow';
import { engineer } from './agents/engineer/agent.js';
import { log } from './observability.js';
import type { StateStore } from './state.js';

/**
 * Sequence: run-task → done
 *
 * Extend this plan as the crew grows. Every failure path must escalate and
 * return — never throw to the HTTP layer.
 */
export async function runWorkflow(issueKey: string, state: StateStore): Promise<void> {
  const engine = createWorkflowEngine({
    store: state,
    logger: log,
    async onEscalate(key, step, reason) {
      log.warn('workflow.escalate', { issueKey: key, step, reason });
    },
  });

  const plan: WorkflowPlan = {
    issueKey,
    steps: [{ name: 'run-task', agent: engineer }],
  };

  await engine.run(plan, { task: 'run-task' });
}
