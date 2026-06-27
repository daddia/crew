import { z, type ZodRawShape } from 'zod';
import {
  createSubmitResultCapture,
  type AgentResult,
  type SubmittedAgentResult,
} from '@daddia/crew';

const blockerSchema = z.object({
  category: z.enum(['architecture', 'technical-ac', 'security', 'other']),
  summary: z.string().min(1),
  filePath: z.string().optional(),
});

const acCoverageSchema = z.object({
  criterion: z.string().min(1),
  status: z.enum(['met', 'partial', 'not-met']),
});

/** Zod shape for FinalReviewArtefact validated at the submit_result boundary. */
export const finalReviewArtefactsShape = {
  verdict: z.enum(['approve', 'block']),
  blockers: z.array(blockerSchema).optional(),
  warnings: z.array(z.string()).optional(),
  acCoverage: z.array(acCoverageSchema).optional(),
} satisfies ZodRawShape;

export function createFinalReviewSubmitResultCapture() {
  return createSubmitResultCapture(z.object(finalReviewArtefactsShape));
}

export function buildFinalReviewAgentResult(
  sessionId: string,
  submitted: SubmittedAgentResult,
  costUsd: number,
): AgentResult {
  const verdict = submitted.artefacts['verdict'];
  const blockers = submitted.artefacts['blockers'];
  const warnings = submitted.artefacts['warnings'];
  const acCoverage = submitted.artefacts['acCoverage'];

  return {
    success: submitted.success && verdict === 'approve',
    summary: submitted.summary,
    artefacts: {
      sessionId,
      verdict,
      ...(Array.isArray(blockers) ? { blockers } : {}),
      ...(Array.isArray(warnings) ? { warnings } : {}),
      ...(Array.isArray(acCoverage) ? { acCoverage } : {}),
    },
    costUsd,
  };
}
