import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildToolAllowlistGuard, type Agent, type AgentInput, type AgentResult } from '@daddia/crew';
import type { EvalSessionResult } from '@daddia/crew/evals';
import { runStory, type WorkflowCtxBase } from '../workflow.js';
import { createStateStore } from '../state.js';
import type { GitlabClient } from '../integrations/gitlab.js';
import type { JiraClient } from '../integrations/jira.js';

const FIXTURE_ISSUE_KEY = 'EVAL-FIXTURE';

/** Engineer workspace allowlist — mirrors production engineer/agent.ts. */
const ENGINEER_WORKSPACE_ALLOWLIST = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Task',
  'mcp__atlassian__jira_get_issue',
  'mcp__atlassian__jira_add_comment',
  'mcp__gitlab__get_merge_request',
  'mcp__gitlab__create_note',
  'mcp__gitlab__list_merge_request_diffs',
] as const;

const DENIED_MERGE_TOOL = 'mcp__gitlab__merge_merge_request';

const DEFAULT_MODEL_ROUTING = {
  lowCost: 'claude-sonnet-eval',
  implementation: 'claude-opus-eval',
} as const;

function successResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'ok',
    artefacts: { branchName: 'feature/EVAL-FIXTURE-test', title: 'Eval Fixture' },
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
      description: 'Fixture-owned workflow eval — never passes peer review.',
      acceptanceCriteria: 'Peer review always requests changes.',
    }),
    searchIssues: async () => [],
    getComments: async () => [],
  };
}

function makeRecordingGitlab(mrUrl = 'https://gitlab.example.com/mr/eval-fixture-1'): GitlabClient {
  return {
    createMr: async () => mrUrl,
    getPipelineStatus: async () => 'success',
    getMrDiff: async () => '',
    postReviewComment: async () => {},
    getMrSourceBranch: async () => 'feature/EVAL-FIXTURE-test',
  };
}

function makeStubEngineer(): Agent {
  return {
    name: 'engineer',
    run: async (input: AgentInput) => {
      const task = input.context['task'];
      if (
        task === 'assess-clarification' ||
        task === 'implement-story' ||
        task === 'address-feedback' ||
        task === 'fix-ci'
      ) {
        return successResult();
      }
      return successResult({ success: false, summary: `Unexpected task: ${String(task)}` });
    },
  };
}

function makeNeverPassingSeniorEngineer(onReview: () => void): Agent {
  return {
    name: 'senior-engineer',
    run: async () => {
      onReview();
      return successResult({
        success: false,
        artefacts: { comments: ['Naming convention not met — please rename symbols.'] },
      });
    },
  };
}

function makePassingSeniorEngineer(): Agent {
  return {
    name: 'senior-engineer',
    run: async () => successResult(),
  };
}

async function withWorkflowFixture(
  options: {
    refactorLoopCap?: number;
    agents: { engineer: Agent; seniorEngineer: Agent };
    mrUrl?: string;
  },
  run: (ctx: {
    jira: RecordingJira;
    mrUrl: string;
    refactorLoopCap: number;
    mrCreated: boolean;
  }) => Promise<EvalSessionResult>,
): Promise<EvalSessionResult> {
  const refactorLoopCap = options.refactorLoopCap ?? 2;
  const jira = makeRecordingJira();
  const mrUrl = options.mrUrl ?? 'https://gitlab.example.com/mr/eval-fixture-1';
  let mrCreated = false;
  const gitlab: GitlabClient = {
    ...makeRecordingGitlab(mrUrl),
    createMr: async () => {
      mrCreated = true;
      return mrUrl;
    },
  };

  const dbDir = await mkdtemp(join(tmpdir(), 'crew-eval-workflow-'));
  const state = createStateStore(join(dbDir, 'eval.db'));

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      refactorLoopCap,
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
  };

  try {
    await runStory(
      { issueKey: FIXTURE_ISSUE_KEY, state, ...ctxBase },
      { agents: options.agents },
    );
    return await run({ jira, mrUrl, refactorLoopCap, mrCreated });
  } finally {
    state.close();
    await rm(dbDir, { recursive: true, force: true });
  }
}

/** Fixture: peer review never passes until REFACTOR_LOOP_CAP, then escalates. */
export async function runLoopCapEscalationFixture(): Promise<EvalSessionResult> {
  let peerReviewIterations = 0;

  return withWorkflowFixture(
    {
      refactorLoopCap: 2,
      agents: {
        engineer: makeStubEngineer(),
        seniorEngineer: makeNeverPassingSeniorEngineer(() => {
          peerReviewIterations += 1;
        }),
      },
    },
    ({ jira, refactorLoopCap, mrCreated }) => {
      const escalated = jira.transitions.includes('Needs human review');

      return Promise.resolve({
        success: escalated,
        summary: escalated
          ? 'Refactor loop cap reached — escalated to human review'
          : 'Workflow did not escalate to human review',
        artefacts: {
          fixture: 'loop-cap-escalation',
          issueKey: FIXTURE_ISSUE_KEY,
          jiraTransitions: [...jira.transitions],
          jiraTransition: jira.transitions.at(-1),
          peerReviewIterations,
          refactorLoopCap,
          mrOpened: mrCreated,
          escalationReason: 'Refactor loop cap reached',
        },
        costUsd: 0,
      });
    },
  );
}

export async function runToolAllowlistDenialFixture(): Promise<EvalSessionResult> {
  let denial: { tool: string; reason: string } | undefined;

  const guard = buildToolAllowlistGuard([...ENGINEER_WORKSPACE_ALLOWLIST], (event) => {
    denial = { tool: event.tool, reason: event.reason };
  });

  const result = await guard(DENIED_MERGE_TOOL, { project_id: 'eval-fixture' }, {
    signal: new AbortController().signal,
    toolUseID: 'toolu_eval_fixture',
  });

  const denied = result.behavior === 'deny';

  return {
    success: denied,
    summary: denied
      ? `Tool ${DENIED_MERGE_TOOL} denied by allowlist guard`
      : 'Expected allowlist denial did not occur',
    artefacts: {
      fixture: 'tool-allowlist-denial',
      deniedTool: DENIED_MERGE_TOOL,
      allowlistEnforced: denied,
      allowedTools: [...ENGINEER_WORKSPACE_ALLOWLIST],
      denial,
    },
    costUsd: 0,
  };
}

/** Fixture: happy-path workflow emits ready-for-qa handoff artefact shape. */
export async function runHandoffArtefactFixture(): Promise<EvalSessionResult> {
  const mrUrl = 'https://gitlab.example.com/mr/eval-handoff';

  return withWorkflowFixture(
    {
      mrUrl,
      agents: {
        engineer: makeStubEngineer(),
        seniorEngineer: makePassingSeniorEngineer(),
      },
    },
    ({ jira, mrUrl: resolvedMrUrl }) => {
      const handedOff = jira.transitions.includes('In QA');

      return Promise.resolve({
        success: handedOff,
        summary: handedOff ? 'Workflow handed off to QA' : 'Workflow did not reach In QA',
        artefacts: {
          fixture: 'handoff-artefact',
          issueKey: FIXTURE_ISSUE_KEY,
          mrUrl: resolvedMrUrl,
          jiraTransition: 'In QA',
          jiraTransitions: [...jira.transitions],
          terminalStep: 'in-qa',
          handoffEvent: {
            issueKey: FIXTURE_ISSUE_KEY,
            mrUrl: resolvedMrUrl,
          },
        },
        costUsd: 0,
      });
    },
  );
}
