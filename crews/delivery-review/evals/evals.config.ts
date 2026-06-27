import type { EvalConfig } from '@daddia/crew/evals';

export default {
  baseUrl: process.env['CREW_EVAL_BASE_URL'] ?? 'http://localhost:3002',
  timeoutMs: 120_000,
} satisfies EvalConfig;
