import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
import { fixtureEngineerResult, type StoryFixture } from './types.js';

/** Deterministic engineer persona for offline fixture runs (no LLM or MCP). */
export function createFixtureEngineer(fixture: StoryFixture): Agent {
  return {
    name: 'engineer',
    run: async (input: AgentInput): Promise<AgentResult> => {
      const task = input.context['task'];
      if (task === 'assess-clarification') {
        return fixtureEngineerResult(fixture.engineer.assess);
      }
      if (task === 'implement-story') {
        return fixtureEngineerResult(fixture.engineer.implement);
      }
      return {
        success: false,
        summary: `Fixture engineer does not handle task: ${String(task)}`,
        artefacts: {},
        costUsd: 0,
      };
    },
  };
}
