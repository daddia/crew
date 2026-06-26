import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SUBMIT_RESULT_TOOL_NAME,
  peerReviewArtefactsShape,
  buildSubmitResultHandler,
  createEngineerSubmitResultCapture,
  flattenReviewComments,
  finalizeAgentRun,
  buildEngineerAgentResult,
  buildPeerReviewAgentResult,
} from '../src/result.js';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

function makeSuccessResultMessage(result = 'prose commentary only'): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: false,
    num_turns: 2,
    result,
    stop_reason: 'end_turn',
    total_cost_usd: 0.02,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: 'uuid-1' as never,
    session_id: 'sess-1',
  } as SDKResultMessage;
}

describe('submit_result capture (RH01-11)', () => {
  it('Gherkin: captures a structured result without parsing final prose', async () => {
    const state = buildSubmitResultHandler(z.record(z.string(), z.unknown()));
    const response = await state.handle({
      success: true,
      summary: 'Done.',
      artefacts: { branchName: 'feature/test', title: 'Test' },
    });

    expect(response.isError).not.toBe(true);
    expect(state.getSubmitted()).toEqual({
      success: true,
      summary: 'Done.',
      artefacts: { branchName: 'feature/test', title: 'Test' },
    });

    const capture = {
      toolName: SUBMIT_RESULT_TOOL_NAME,
      mcpServers: {},
      getSubmitted: state.getSubmitted,
    };

    const agentResult = finalizeAgentRun({
      sessionId: 'sess-1',
      capture,
      resultMsg: makeSuccessResultMessage('Here is some commentary before the result.'),
      buildResult: (submitted, costUsd) =>
        buildEngineerAgentResult('sess-1', submitted, costUsd),
    });

    expect(agentResult.success).toBe(true);
    expect(agentResult.summary).toBe('Done.');
    expect(agentResult.artefacts).toMatchObject({
      sessionId: 'sess-1',
      branchName: 'feature/test',
      title: 'Test',
    });
  });

  it('Gherkin: rejects a malformed peer-review payload at the tool boundary', async () => {
    const { handle, getSubmitted } = buildSubmitResultHandler(z.object(peerReviewArtefactsShape));
    const response = await handle({
      success: true,
      summary: 'Missing verdict.',
      artefacts: { comments: [] },
    });

    expect(response.isError).toBe(true);
    expect(getSubmitted()).toBeUndefined();
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('validation failed');
    expect(text).toContain('verdict');
  });

  it('returns failure when submit_result was never called', () => {
    const capture = createEngineerSubmitResultCapture();
    const agentResult = finalizeAgentRun({
      sessionId: 'sess-1',
      capture,
      resultMsg: makeSuccessResultMessage('{"success":true}'),
      buildResult: (submitted, costUsd) =>
        buildEngineerAgentResult('sess-1', submitted, costUsd),
    });

    expect(agentResult.success).toBe(false);
    expect(agentResult.summary).toContain('submit_result');
  });

  it('exposes the MCP tool name for allowlist wiring', () => {
    const capture = createEngineerSubmitResultCapture();
    expect(capture.toolName).toBe(SUBMIT_RESULT_TOOL_NAME);
  });

  it('Gherkin: maxTurns exhaustion returns bounded-operation failure', () => {
    const capture = createEngineerSubmitResultCapture();
    const resultMsg = {
      ...makeSuccessResultMessage(),
      subtype: 'error_max_turns' as const,
      is_error: true,
      total_cost_usd: 1.5,
    };

    const agentResult = finalizeAgentRun({
      sessionId: 'sess-1',
      capture,
      resultMsg,
      buildResult: (submitted, costUsd) =>
        buildEngineerAgentResult('sess-1', submitted, costUsd),
    });

    expect(agentResult.success).toBe(false);
    expect(agentResult.summary).toContain('maxTurns');
    expect(agentResult.artefacts).toMatchObject({
      sessionId: 'sess-1',
      boundedReason: 'max_turns',
    });
    expect(agentResult.costUsd).toBe(1.5);
  });
});

describe('flattenReviewComments()', () => {
  it('flattens structured comment objects', () => {
    expect(
      flattenReviewComments([
        {
          path: 'src/x.ts',
          line: 7,
          category: 'blocker',
          observed: 'issue',
          remediation: 'fix it',
        },
      ]),
    ).toEqual(['src/x.ts:7 [blocker] issue — fix it']);
  });

  it('passes through string comments', () => {
    expect(flattenReviewComments(['already formatted'])).toEqual(['already formatted']);
  });
});

describe('buildPeerReviewAgentResult()', () => {
  it('clears comments on approved verdict', () => {
    const result = buildPeerReviewAgentResult(
      'sess-1',
      {
        success: true,
        summary: 'Approved.',
        artefacts: {
          verdict: 'approved',
          comments: ['should be ignored'],
        },
      },
      0.01,
    );

    expect(result.success).toBe(true);
    expect(result.artefacts['comments']).toEqual([]);
  });

  it('sets success false for changes-requested', () => {
    const result = buildPeerReviewAgentResult(
      'sess-1',
      {
        success: false,
        summary: 'Blockers found.',
        artefacts: {
          verdict: 'changes-requested',
          comments: ['src/a.ts:1 [blocker] bug — fix'],
        },
      },
      0.01,
    );

    expect(result.success).toBe(false);
    expect(result.artefacts['comments']).toEqual(['src/a.ts:1 [blocker] bug — fix']);
  });
});
