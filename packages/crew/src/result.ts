import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z, type ZodError, type ZodRawShape } from 'zod';
import type { AgentResult } from './agent.js';
import type { AgentSession } from './session.js';
import { formatZodIssues } from './config/errors.js';

export const SUBMIT_RESULT_SERVER_NAME = 'crew';
export const SUBMIT_RESULT_TOOL_NAME = `mcp__${SUBMIT_RESULT_SERVER_NAME}__submit_result`;

/** Payload accepted by the in-process submit_result tool. */
export interface SubmittedAgentResult {
  success: boolean;
  summary: string;
  artefacts: Record<string, unknown>;
}

/** In-process MCP server that captures a persona's structured result. */
export interface SubmitResultCapture {
  readonly toolName: typeof SUBMIT_RESULT_TOOL_NAME;
  readonly mcpServers: Record<string, McpServerConfig>;
  getSubmitted(): SubmittedAgentResult | undefined;
}

const reviewCommentSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    line: z.union([z.number(), z.string()]),
    category: z.string(),
    observed: z.string(),
    remediation: z.string(),
  }),
]);

/** Zod shape for peer-review artefacts validated at the submit_result boundary. */
export const peerReviewArtefactsShape = {
  verdict: z.enum(['approved', 'changes-requested']),
  comments: z.array(reviewCommentSchema),
} satisfies ZodRawShape;

function buildSubmitShape(artefactsField: z.ZodType<Record<string, unknown>>): ZodRawShape {
  return {
    success: z.boolean(),
    summary: z.string().min(1),
    artefacts: artefactsField,
  };
}

function validationErrorResult(err: ZodError): { content: { type: 'text'; text: string }[]; isError: true } {
  return {
    content: [
      {
        type: 'text',
        text: `submit_result validation failed — correct the payload and call submit_result again:\n${formatZodIssues(err)}`,
      },
    ],
    isError: true,
  };
}

/** Handler state shared by the MCP tool and unit tests. */
export function buildSubmitResultHandler(artefactsField: z.ZodType<Record<string, unknown>>): {
  submitShape: ZodRawShape;
  handle: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
  getSubmitted: () => SubmittedAgentResult | undefined;
} {
  const submitShape = buildSubmitShape(artefactsField);
  const submitSchema = z.object(submitShape);
  let captured: SubmittedAgentResult | undefined;

  const handle = async (args: Record<string, unknown>) => {
    const parsed = submitSchema.safeParse(args);
    if (!parsed.success) {
      return validationErrorResult(parsed.error);
    }

    const data = parsed.data as {
      success: boolean;
      summary: string;
      artefacts: Record<string, unknown>;
    };
    captured = {
      success: data.success,
      summary: data.summary,
      artefacts: data.artefacts,
    };

    return {
      content: [{ type: 'text' as const, text: 'Result accepted.' }],
    };
  };

  return {
    submitShape,
    handle,
    getSubmitted: () => captured,
  };
}

/**
 * Create an in-process MCP server with a typed `submit_result` tool.
 * The tool validates the payload, rejects malformed input at the boundary,
 * and stores the last successful submission for the caller to read.
 */
export function createSubmitResultCapture(
  artefactsField: z.ZodType<Record<string, unknown>>,
): SubmitResultCapture {
  const state = buildSubmitResultHandler(artefactsField);

  const submitResultTool = tool(
    'submit_result',
    'Submit the structured AgentResult for this run. Call once when work is complete.',
    state.submitShape,
    state.handle,
    { alwaysLoad: true },
  );

  const server = createSdkMcpServer({
    name: SUBMIT_RESULT_SERVER_NAME,
    instructions:
      'Call submit_result once with the structured AgentResult when the task is complete. Prose commentary is fine, but the workflow only reads submit_result.',
    tools: [submitResultTool],
    alwaysLoad: true,
  });

  return {
    toolName: SUBMIT_RESULT_TOOL_NAME,
    mcpServers: { [SUBMIT_RESULT_SERVER_NAME]: server },
    getSubmitted: state.getSubmitted,
  };
}

/** Engineer personas accept any artefact object; skills document required fields. */
export function createEngineerSubmitResultCapture(): SubmitResultCapture {
  return createSubmitResultCapture(z.record(z.string(), z.unknown()));
}

/** Senior-engineer peer review requires verdict and comments. */
export function createPeerReviewSubmitResultCapture(): SubmitResultCapture {
  return createSubmitResultCapture(z.object(peerReviewArtefactsShape));
}

/** Flatten structured or string review comments into workflow-ready strings. */
export function flattenReviewComments(comments: unknown): string[] {
  if (!Array.isArray(comments)) {
    throw new Error('comments field is not an array');
  }

  return comments.map((comment, index) => {
    if (typeof comment === 'string') return comment;
    if (typeof comment === 'object' && comment !== null && !Array.isArray(comment)) {
      const co = comment as Record<string, unknown>;
      return `${String(co['path'] ?? '')}:${String(co['line'] ?? '')} [${String(co['category'] ?? '')}] ${String(co['observed'] ?? '')} — ${String(co['remediation'] ?? '')}`;
    }
    throw new Error(`Comment at index ${index} has unexpected type`);
  });
}

/** Iterate the session stream until the SDK result message arrives. */
export async function collectSessionOutcome(
  session: AgentSession,
): Promise<{ resultMsg: SDKResultMessage | undefined }> {
  let resultMsg: SDKResultMessage | undefined;
  for await (const msg of session.stream()) {
    if (msg.type === 'result') {
      resultMsg = msg;
      break;
    }
  }
  return { resultMsg };
}

export interface FinalizeAgentRunOptions {
  sessionId: string;
  capture: SubmitResultCapture;
  resultMsg: SDKResultMessage | undefined;
  buildResult: (submitted: SubmittedAgentResult, costUsd: number) => AgentResult;
}

/**
 * Build an AgentResult from a captured submit_result payload.
 * Never parses the SDK result message prose as JSON.
 */
export function finalizeAgentRun(options: FinalizeAgentRunOptions): AgentResult {
  const { sessionId, capture, resultMsg, buildResult } = options;

  if (!resultMsg) {
    return {
      success: false,
      summary: 'Session ended without a result message',
      artefacts: { sessionId },
      costUsd: 0,
    };
  }

  if (resultMsg.subtype !== 'success') {
    return {
      success: false,
      summary: resultMsg.errors.join('; '),
      artefacts: { sessionId },
      costUsd: resultMsg.total_cost_usd,
    };
  }

  const submitted = capture.getSubmitted();
  if (!submitted) {
    return {
      success: false,
      summary:
        'Session completed without submit_result — call the submit_result tool with the structured AgentResult payload',
      artefacts: { sessionId },
      costUsd: resultMsg.total_cost_usd,
    };
  }

  return buildResult(submitted, resultMsg.total_cost_usd);
}

export function buildEngineerAgentResult(
  sessionId: string,
  submitted: SubmittedAgentResult,
  costUsd: number,
): AgentResult {
  return {
    success: submitted.success,
    summary: submitted.summary,
    artefacts: { sessionId, ...submitted.artefacts },
    costUsd,
  };
}

export function buildPeerReviewAgentResult(
  sessionId: string,
  submitted: SubmittedAgentResult,
  costUsd: number,
): AgentResult {
  const verdict = submitted.artefacts['verdict'];
  const comments = flattenReviewComments(submitted.artefacts['comments']);

  return {
    success: verdict === 'approved',
    summary: submitted.summary,
    artefacts: {
      sessionId,
      comments: verdict === 'approved' ? [] : comments,
    },
    costUsd,
  };
}
