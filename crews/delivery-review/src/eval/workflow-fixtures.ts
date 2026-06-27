import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
import type { EvalSessionResult } from '@daddia/crew/evals';
import { runReviewWorkflow, type WorkflowCtxBase } from '../workflow.js';
import { createStateStore } from '../state.js';
import type { GitlabClient } from '../integrations/gitlab.js';
import type { JiraClient } from '../integrations/jira.js';

const FIXTURE_ISSUE_KEY = 'EVAL-FIXTURE';
const MERGE_COMMIT_SHA = 'eval-merge-sha-abc123';

function successResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'ok',
    artefacts: { sessionId: 'eval-fixture', verdict: 'approve' },
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
      description: 'Fixture-owned review workflow eval.',
      acceptanceCriteria: 'Tech-lead approves and PM signs off before merge.',
    }),
    getIssueStatus: async () => 'In Review',
    searchIssues: async () => [],
    getComments: async () => [],
  };
}

function makeRecordingGitlab(
  mrUrl = 'https://gitlab.example.com/mr/eval-review-handoff-done',
): GitlabClient {
  return {
    getPipelineStatus: async () => 'success',
    getMrSourceBranch: async () => 'feature/EVAL-FIXTURE-test',
    findOpenMrForIssue: async () => mrUrl,
    findMrForIssue: async () => ({ mrUrl, state: 'opened' as const }),
    getMrDiff: async () => '',
    approveMergeRequest: async () => {},
    mergeMergeRequest: async () => MERGE_COMMIT_SHA,
  };
}

function makeStubTechLead(): Agent {
  return {
    name: 'tech-lead',
    run: async (input: AgentInput) => {
      const task = input.context['task'];
      if (task === 'final-code-review') {
        return successResult({
          summary: 'Final review approved.',
          artefacts: {
            sessionId: 'eval-fixture-review',
            verdict: 'approve',
            blockers: [],
            acCoverage: [{ criterion: 'All AC met', status: 'met' }],
          },
        });
      }
      if (task === 'publish-review-summary') {
        return successResult({
          summary: 'Posted review summary comment.',
          artefacts: { sessionId: 'eval-fixture-summary', verdict: 'approve' },
        });
      }
      return successResult({ success: false, summary: `Unexpected task: ${String(task)}` });
    },
  };
}

async function withHandoffDoneFixture(
  run: (ctx: {
    jira: RecordingJira;
    mrUrl: string;
    mergeCommitSha: string;
  }) => Promise<EvalSessionResult>,
): Promise<EvalSessionResult> {
  const jira = makeRecordingJira();
  const mrUrl = 'https://gitlab.example.com/mr/eval-review-handoff-done';
  const gitlab = makeRecordingGitlab(mrUrl);

  const dbDir = await mkdtemp(join(tmpdir(), 'crew-eval-review-workflow-'));
  const state = createStateStore(join(dbDir, 'eval.db'));

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      pmReviewTimeoutHours: 48,
      pmApprovalCommentPattern: '/pm-approve',
      techLeadMaxTurns: 30,
      techLeadCostCapUsd: 5,
      diffFileCap: 50,
      diffSizeCapBytes: 500_000,
    },
    jira,
    gitlab,
  };

  const agents = { techLead: makeStubTechLead() };

  try {
    await runReviewWorkflow(
      { issueKey: FIXTURE_ISSUE_KEY, state, ...ctxBase },
      { agents },
    );

    await runReviewWorkflow(
      { issueKey: FIXTURE_ISSUE_KEY, state, ...ctxBase },
      { agents, resumeFromMerge: true },
    );

    return await run({ jira, mrUrl, mergeCommitSha: MERGE_COMMIT_SHA });
  } finally {
    state.close();
    await rm(dbDir, { recursive: true, force: true });
  }
}

/** Fixture: happy-path review workflow emits Done handoff artefact shape. */
export async function runHandoffDoneFixture(): Promise<EvalSessionResult> {
  return withHandoffDoneFixture(({ jira, mrUrl, mergeCommitSha }) => {
    const handedOff = jira.transitions.includes('Done');

    return Promise.resolve({
      success: handedOff,
      summary: handedOff ? 'Workflow handed off to Done' : 'Workflow did not reach Done',
      artefacts: {
        fixture: 'handoff-done',
        issueKey: FIXTURE_ISSUE_KEY,
        mrUrl,
        mergeCommitSha,
        jiraTransition: 'Done',
        jiraTransitions: [...jira.transitions],
        terminalStep: 'done',
        handoffDoneEvent: {
          issueKey: FIXTURE_ISSUE_KEY,
          mrUrl,
          mergeCommitSha,
        },
      },
      costUsd: 0,
    });
  });
}
