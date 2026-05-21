import type { AgentResult } from '../agent.js';
import type { Logger } from '../observability/index.js';
import type { StateStore } from '../state/store.js';
import type { WorkflowPlan } from './plan.js';

export interface WorkflowEngineOptions {
  store: StateStore;
  /** Called when a step fails and its onFailure policy is 'escalate'. */
  onEscalate(issueKey: string, step: string, reason: string): Promise<void>;
  logger?: Logger;
}

export interface WorkflowEngine {
  /**
   * Execute a WorkflowPlan. Steps run sequentially; artefacts from each
   * step are merged into a shared context and forwarded to subsequent steps.
   *
   * @param plan         The ordered sequence of steps to execute.
   * @param initialContext  Optional starting context forwarded to the first step.
   */
  run(plan: WorkflowPlan, initialContext?: Record<string, unknown>): Promise<void>;
}

/**
 * Create a WorkflowEngine that executes a WorkflowPlan step by step.
 *
 * For each step the engine:
 *   1. Writes a crash-recovery marker via store.upsertStory before the run.
 *   2. Calls step.agent.run() with the accumulated context from prior steps.
 *   3. Records session ID and outcome via store.startStep / finishStep after
 *      the run (per convention: sessionId is only known once the run returns).
 *   4. Merges the step's artefacts into the shared context for subsequent steps.
 *   5. Applies the failure policy when success is false and retries are done.
 *
 * This is the single execution path for both deterministic crews (fixed plan)
 * and orchestrator-mode crews (dynamically assembled plan).
 */
export function createWorkflowEngine(options: WorkflowEngineOptions): WorkflowEngine {
  const { store, onEscalate, logger } = options;

  return {
    async run(plan: WorkflowPlan, initialContext: Record<string, unknown> = {}): Promise<void> {
      const { issueKey, steps } = plan;
      const accumulated: Record<string, unknown> = { ...initialContext };

      for (const step of steps) {
        const maxAttempts = (step.maxRetries ?? 0) + 1;
        let advanced = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // Crash-recovery marker written before the run. A stories row whose
          // current_step has no matching finished steps row indicates a crash.
          store.upsertStory(issueKey, step.name);

          let result: AgentResult;
          try {
            result = await step.agent.run({ issueKey, context: { ...accumulated } });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logger?.warn('workflow.step.threw', { issueKey, step: step.name, attempt, err: reason });
            store.startStep(issueKey, step.name);
            store.finishStep(issueKey, step.name, { verdict: 'threw' });
            if (attempt + 1 < maxAttempts) continue;
            await onEscalate(issueKey, step.name, `Step threw: ${reason}`);
            return;
          }

          // startStep is called after agent.run() so the sessionId from artefacts
          // can be captured in the same row (trade-off documented in AGENTS.md).
          const sessionId = result.artefacts['sessionId'] as string | undefined;
          store.startStep(issueKey, step.name, sessionId);
          store.finishStep(issueKey, step.name, {
            costUsd: result.costUsd,
            verdict: result.success ? 'ok' : 'failed',
          });

          if (result.success) {
            Object.assign(accumulated, result.artefacts);
            logger?.info('workflow.step.ok', { issueKey, step: step.name, costUsd: result.costUsd });
            advanced = true;
            break;
          }

          logger?.warn('workflow.step.failed', {
            issueKey,
            step: step.name,
            attempt,
            summary: result.summary,
          });

          if (attempt + 1 < maxAttempts) continue; // exhaust retries before applying policy

          const policy = step.onFailure ?? 'escalate';
          if (policy === 'escalate') {
            await onEscalate(issueKey, step.name, result.summary);
            return;
          }
          if (policy === 'stop') {
            return;
          }
          // policy === 'continue': merge artefacts and proceed
          Object.assign(accumulated, result.artefacts);
          advanced = true;
        }

        if (!advanced) return;
      }
    },
  };
}
