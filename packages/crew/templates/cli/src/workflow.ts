import { engineer } from './agents/engineer/agent.js';
import { log } from './observability.js';

/** Run the CLI workflow to completion and write results to the system of record. */
export async function runWorkflow(issueKey: string): Promise<void> {
  log.info('workflow.start', { issueKey });
  const result = await engineer.run({ issueKey, context: { task: 'run-task' } });
  if (!result.success) {
    log.error('workflow.failed', { issueKey, summary: result.summary });
    process.exitCode = 1;
  }
}
