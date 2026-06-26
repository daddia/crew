import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSession, SubmittedAgentResult, SubmitResultCapture } from '@daddia/crew';
import type { SDKResultMessage } from '@daddia/crew';
import type { AgentInput } from '@daddia/crew';

const DEFAULT_SUBMITTED: SubmittedAgentResult = {
  success: true,
  summary: 'No blocking issues.',
  artefacts: { verdict: 'approved', comments: [] },
};

let submittedResult: SubmittedAgentResult | undefined = DEFAULT_SUBMITTED;

function makeCapture(): SubmitResultCapture {
  return {
    toolName: 'mcp__crew__submit_result',
    mcpServers: {},
    getSubmitted: () => submittedResult,
  };
}

vi.mock('@daddia/crew', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@daddia/crew')>();
  return {
    ...actual,
    resolveSession: vi.fn(),
    readPromptFile: vi.fn().mockResolvedValue('You are a senior-engineer persona.'),
    readSkillsDir: vi.fn().mockResolvedValue([]),
    readSubagentsDir: vi.fn().mockResolvedValue([]),
    buildAuditHook: vi.fn().mockReturnValue(() => {}),
    createPeerReviewSubmitResultCapture: vi.fn(() => makeCapture()),
  };
});

import { resolveSession, readPromptFile, buildAuditHook } from '@daddia/crew';
import { seniorEngineer } from '../src/agents/senior-engineer/agent.js';

const mockResolveSession = vi.mocked(resolveSession);
const mockReadPromptFile = vi.mocked(readPromptFile);
const mockBuildAuditHook = vi.mocked(buildAuditHook);

function makeResultMessage(overrides: Partial<SDKResultMessage> = {}): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 800,
    duration_api_ms: 600,
    is_error: false,
    num_turns: 2,
    result: 'Review complete. See submit_result for the structured verdict.',
    stop_reason: 'end_turn',
    total_cost_usd: 0.03,
    usage: {
      input_tokens: 80,
      output_tokens: 150,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: 'test-uuid-se-1' as never,
    session_id: 'sess-se-123',
    ...overrides,
  } as SDKResultMessage;
}

function makeSession(messages: SDKResultMessage[] = []): AgentSession {
  return {
    sessionId: 'sess-se-123',
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      for (const msg of messages) {
        yield msg;
      }
    }),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  };
}

const baseInput: AgentInput = {
  issueKey: 'CREW-50-003',
  context: { task: 'peer-code-review', branchName: 'feature/CREW-50-003-test' },
};

describe('seniorEngineer.run()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submittedResult = DEFAULT_SUBMITTED;
  });

  it('returns AgentResult with success true when SDK session completes with approved verdict', async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.summary).toBe(DEFAULT_SUBMITTED.summary);
    expect(result.costUsd).toBe(0.03);
    expect(result.artefacts).toMatchObject({ sessionId: 'sess-se-123', comments: [] });
  });

  it('returns AgentResult with success false when SDK session returns an error result', async () => {
    const session = makeSession([
      makeResultMessage({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Context window exceeded'],
        total_cost_usd: 0.02,
      } as Partial<SDKResultMessage>),
    ]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Context window exceeded');
  });

  it('returns AgentResult with success false when SDK throws', async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Connection refused');
  });

  it('calls buildAuditHook() once before SDK execution', async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockBuildAuditHook).toHaveBeenCalledOnce();
    expect(mockBuildAuditHook).toHaveBeenCalledBefore(session.send as ReturnType<typeof vi.fn>);
  });

  it('passes the audit hook to resolveSession as auditHook', async () => {
    const fakeHook = vi.fn();
    mockBuildAuditHook.mockReturnValue(fakeHook);
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ auditHook: fakeHook }),
    );
  });

  it('sends the persona prompt in the session message', async () => {
    const session = makeSession([makeResultMessage()]);
    mockReadPromptFile.mockResolvedValue('SENIOR ENGINEER INSTRUCTIONS');
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    const sent = (session.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sent).toContain('SENIOR ENGINEER INSTRUCTIONS');
  });

  it("passes memory: 'project' in the AgentDefinition to resolveSession", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({ memory: 'project' }),
      }),
    );
  });

  it('reads the prompt file from the definition', async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockReadPromptFile).toHaveBeenCalledOnce();
  });

  it('disposes the session after run completes', async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it('disposes the session even when SDK throws', async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Unexpected failure'));
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it('Gherkin: approval result sets success true and comments to empty array', async () => {
    submittedResult = {
      success: true,
      summary: 'No blocking issues.',
      artefacts: { verdict: 'approved', comments: [] },
    };
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.artefacts['comments']).toEqual([]);
    expect(result.artefacts['sessionId']).toBe('sess-se-123');
  });

  it('Gherkin: changes-requested with structured findings sets success false and flattens comments', async () => {
    submittedResult = {
      success: false,
      summary: 'Two blockers found.',
      artefacts: {
        verdict: 'changes-requested',
        comments: [
          {
            path: 'src/foo.ts',
            line: 42,
            category: 'blocker',
            observed: 'null dereference',
            remediation: 'add null check',
          },
          {
            path: 'src/bar.ts',
            line: 'L10',
            category: 'warning',
            observed: 'missing test',
            remediation: 'add unit test',
          },
        ],
      },
    };
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    const comments = result.artefacts['comments'] as string[];
    expect(comments).toHaveLength(2);
    expect(comments[0]).toBe('src/foo.ts:42 [blocker] null dereference — add null check');
    expect(comments[1]).toBe('src/bar.ts:L10 [warning] missing test — add unit test');
    expect(result.artefacts['sessionId']).toBe('sess-se-123');
  });

  it('Gherkin: changes-requested preserves pre-formatted string comments', async () => {
    submittedResult = {
      success: false,
      summary: 'One blocker.',
      artefacts: {
        verdict: 'changes-requested',
        comments: ['src/auth.ts:L5 [blocker] path traversal — validate input'],
      },
    };
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.artefacts['comments']).toEqual([
      'src/auth.ts:L5 [blocker] path traversal — validate input',
    ]);
  });

  it('Gherkin: missing submit_result downgrades to success false', async () => {
    submittedResult = undefined;
    const session = makeSession([makeResultMessage({ result: 'not json at all' })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('submit_result');
    expect(result.artefacts['sessionId']).toBe('sess-se-123');
  });

  it('forces comments to empty array on approved verdict even if model populates comments', async () => {
    submittedResult = {
      success: true,
      summary: 'Approved with suggestion.',
      artefacts: {
        verdict: 'approved',
        comments: [
          {
            path: 'src/a.ts',
            line: 1,
            category: 'suggestion',
            observed: 'minor',
            remediation: 'fix',
          },
        ],
      },
    };
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: 'sess-se-123',
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.artefacts['comments']).toEqual([]);
  });
});
