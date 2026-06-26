import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
import type { EvalSessionResult } from '@daddia/crew/evals';
import { runQaWorkflow, type WorkflowCtxBase } from '../workflow.js';
import { createStateStore } from '../state.js';
import type { GitlabClient } from '../integrations/gitlab.js';
import type { JiraClient } from '../integrations/jira.js';
import type { QaWorkspacePort } from '../qa-workspace.js';

const FIXTURE_ISSUE_KEY = 'EVAL-FIXTURE';

function successResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'ok',
    artefacts: { sessionId: 'eval-fixture', verdict: 'pass' },
    costUsd: 0,
    ...overrides,
  };
}

interface RecordingJira extends JiraClient {
  transitions: string[];
  comments: string[];
}

function makeRecordingJira(): RecordingJira {
  const transitions: string[] = [];
  const comments: string[] = [];
  return {
    transitions,
    comments,
    transitionIssue: async (_issueKey, status) => {
      transitions.push(status);
      return true;
    },
    commentOnIssue: async (_issueKey, body) => {
      comments.push(body);
    },
    getIssue: async () => ({
      summary: 'Eval fixture story',
      description: 'Fixture-owned QA workflow eval.',
      acceptanceCriteria: 'All QA steps pass in the sandbox.',
    }),
    searchIssues: async () => [],
    getComments: async () => [],
    addLabel: async () => {},
  };
}

function makeRecordingGitlab(
  mrUrl = 'https://gitlab.example.com/mr/eval-qa-handoff',
): GitlabClient {
  return {
    getPipelineStatus: async () => 'success',
    getMrSourceBranch: async () => 'feature/EVAL-FIXTURE-test',
    findOpenMrForIssue: async () => mrUrl,
  };
}

function makeStubQaEngineer(): Agent {
  return {
    name: 'qa-engineer',
    run: async (input: AgentInput) => {
      const task = input.context['task'];
      if (
        task === 'deploy-qa' ||
        task === 'run-automated-suite' ||
        task === 'exploratory-pass' ||
        task === 'document-defects'
      ) {
        return successResult();
      }
      return successResult({ success: false, summary: `Unexpected task: ${String(task)}` });
    },
  };
}

function makePassingWorkspace(): QaWorkspacePort {
  return {
    checkoutMrRef: async () => {},
    runDeployScript: async () => {},
    runTestCommand: async () => ({ exitCode: 0, output: 'all tests passed' }),
  };
}

async function withWorkflowFixture(
  run: (ctx: { jira: RecordingJira; mrUrl: string }) => Promise<EvalSessionResult>,
): Promise<EvalSessionResult> {
  const jira = makeRecordingJira();
  const mrUrl = 'https://gitlab.example.com/mr/eval-qa-handoff';
  const gitlab = makeRecordingGitlab(mrUrl);

  const dbDir = await mkdtemp(join(tmpdir(), 'crew-eval-qa-workflow-'));
  const state = createStateStore(join(dbDir, 'eval.db'));

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      qaDefectLoopCap: 2,
      remediationTimeoutHours: 48,
      externalIntegrationMode: 'mock',
      automatedTestCommand: 'pnpm test',
      qaEngineerMaxTurns: 40,
      qaEngineerCostCapUsd: 4,
    },
    jira,
    gitlab,
    qaWorkspaceDir: dbDir,
  };

  try {
    await runQaWorkflow(
      { issueKey: FIXTURE_ISSUE_KEY, state, ...ctxBase },
      {
        agents: { qaEngineer: makeStubQaEngineer() },
        workspace: makePassingWorkspace(),
      },
    );
    return await run({ jira, mrUrl });
  } finally {
    state.close();
    await rm(dbDir, { recursive: true, force: true });
  }
}

/** Fixture: happy-path QA workflow emits ready-for-review handoff artefact shape. */
export async function runHandoffFixture(): Promise<EvalSessionResult> {
  return withWorkflowFixture(({ jira, mrUrl }) => {
    const handedOff = jira.transitions.includes('In Review');

    return Promise.resolve({
      success: handedOff,
      summary: handedOff ? 'Workflow handed off to review' : 'Workflow did not reach In Review',
      artefacts: {
        fixture: 'handoff',
        issueKey: FIXTURE_ISSUE_KEY,
        mrUrl,
        jiraTransition: 'In Review',
        jiraTransitions: [...jira.transitions],
        terminalStep: 'in-review',
        handoffEvent: {
          issueKey: FIXTURE_ISSUE_KEY,
          mrUrl,
        },
      },
      costUsd: 0,
    });
  });
}
