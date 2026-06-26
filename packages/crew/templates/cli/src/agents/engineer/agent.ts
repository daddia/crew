import type { Agent, AgentInput, AgentResult } from '@daddia/crew';

/** Stub persona — replace run() with a full SDK session when implementing. */
async function run(_input: AgentInput): Promise<AgentResult> {
  return {
    success: true,
    summary: 'Stub persona — implement engineer.run()',
    artefacts: {},
    costUsd: 0,
  };
}

export const engineer: Agent = {
  name: 'engineer',
  run,
};
