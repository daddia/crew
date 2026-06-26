import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Agent } from '@daddia/crew';
import { seniorEngineer } from '../agents/senior-engineer/agent.js';
import { createStateStore } from '../state.js';
import { runStory } from '../workflow.js';
import { createFixtureIntegrationClients } from './integration-clients.js';
import { loadStoryFixture } from './load-fixture.js';
import { createFixtureEngineer } from './mock-engineer.js';
import type { StoryDriverResult, StoryFixtureMode } from './types.js';

const DEFAULT_MODEL_ROUTING = {
  lowCost: 'claude-sonnet-fixture',
  implementation: 'claude-opus-fixture',
} as const;

export interface RunFixtureStoryOptions {
  issueKey: string;
  mode?: StoryFixtureMode;
  crewRoot?: string;
}

/** Package root for delivery-build (parent of src/ and fixtures/). */
export function resolveCrewRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function resolveMode(mode: StoryFixtureMode | undefined, env: NodeJS.ProcessEnv): StoryFixtureMode {
  if (mode) {
    return mode;
  }
  const fromEnv = env['CREW_STORY_FIXTURE_MODE'];
  if (fromEnv === 'mock' || fromEnv === 'live') {
    return fromEnv;
  }
  return env['ANTHROPIC_API_KEY'] ? 'live' : 'mock';
}

function engineerForMode(
  mode: StoryFixtureMode,
  fixture: Awaited<ReturnType<typeof loadStoryFixture>>,
): Promise<Agent> {
  if (mode === 'mock') {
    return Promise.resolve(createFixtureEngineer(fixture));
  }
  return import('../agents/engineer/agent.js').then((mod) => mod.engineer);
}

/**
 * Drive context-seed → assess-clarification → implement for a fixture story.
 * Workflow Jira/GitLab are mocked from fixtures/{issueKey}/; no live board credentials.
 */
export async function runFixtureStory(
  options: RunFixtureStoryOptions,
): Promise<StoryDriverResult> {
  const crewRoot = options.crewRoot ?? resolveCrewRoot();
  const mode = resolveMode(options.mode, process.env);
  const fixture = await loadStoryFixture(crewRoot, options.issueKey);
  const { jira, gitlab } = createFixtureIntegrationClients(fixture);
  const engineer = await engineerForMode(mode, fixture);

  const dbDir = await mkdtemp(join(tmpdir(), 'crew-story-fixture-'));
  const state = createStateStore(join(dbDir, 'story-fixture.db'));

  try {
    await runStory(
      {
        issueKey: fixture.issueKey,
        state,
        behaviour: {
          refactorLoopCap: 2,
          ciRetryCap: 3,
          ciPollIntervalMs: 0,
          ciWaitTimeoutMs: 1_800_000,
          engineerMaxTurns: 50,
          engineerCompactionThreshold: 160_000,
          engineerCostCapUsd: 5,
          modelRouting: DEFAULT_MODEL_ROUTING,
        },
        jira,
        gitlab,
        projectDir: dbDir,
      },
      {
        agents: { engineer, seniorEngineer },
        stopAfter: 'implement',
      },
    );

    const history = state.getStepHistory(fixture.issueKey);
    const implementStep = history.find((row) => row.step === 'implement');
    const implementSucceeded = implementStep?.verdict === 'ok';
    const sessionId =
      typeof implementStep?.sessionId === 'string' ? implementStep.sessionId : undefined;

    return {
      success: implementSucceeded,
      issueKey: fixture.issueKey,
      mode,
      terminalStep: state.getStory(fixture.issueKey)?.currentStep ?? 'unknown',
      implementSessionId: sessionId,
      jiraTransitions: [...jira.transitions],
      summary: implementSucceeded
        ? `Fixture story ${fixture.issueKey} completed implement (${mode} engineer)`
        : `Fixture story ${fixture.issueKey} failed at implement`,
    };
  } finally {
    state.close();
    await rm(dbDir, { recursive: true, force: true });
  }
}
