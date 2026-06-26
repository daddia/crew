import { z, type ZodRawShape } from 'zod';
import {
  createSubmitResultCapture,
  type AgentResult,
  type SubmittedAgentResult,
} from '@daddia/crew';

const qaDefectSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['blocker', 'major', 'minor']),
  summary: z.string().min(1),
  stepsToReproduce: z.string().min(1),
  expected: z.string().min(1),
  observed: z.string().min(1),
});

/** Zod shape for QA artefacts validated at the submit_result boundary. */
export const qaArtefactsShape = {
  verdict: z.enum(['pass', 'fail']),
  defects: z.array(qaDefectSchema).optional(),
} satisfies ZodRawShape;

export function createQaSubmitResultCapture() {
  return createSubmitResultCapture(z.object(qaArtefactsShape));
}

export function buildQaAgentResult(
  sessionId: string,
  submitted: SubmittedAgentResult,
  costUsd: number,
): AgentResult {
  const verdict = submitted.artefacts['verdict'];
  const defects = submitted.artefacts['defects'];

  return {
    success: submitted.success && verdict === 'pass',
    summary: submitted.summary,
    artefacts: {
      sessionId,
      verdict,
      ...(Array.isArray(defects) ? { defects } : {}),
    },
    costUsd,
  };
}
