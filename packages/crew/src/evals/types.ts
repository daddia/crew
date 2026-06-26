import type { AgentResult } from '../agent.js';

/** Outcome of a fixture-driven eval session against a crew HTTP surface. */
export interface EvalSessionResult {
  success: boolean;
  summary: string;
  artefacts: Record<string, unknown>;
  costUsd: number;
  sessionId?: string;
}

/** Map an AgentResult into the eval session wire format. */
export function agentResultToSession(result: AgentResult): EvalSessionResult {
  const sessionId =
    typeof result.artefacts['sessionId'] === 'string' ? result.artefacts['sessionId'] : undefined;
  return {
    success: result.success,
    summary: result.summary,
    artefacts: result.artefacts,
    costUsd: result.costUsd,
    sessionId,
  };
}

export type AssertionSeverity = 'gate' | 'soft';

export interface EvalAssertion {
  name: string;
  severity: AssertionSeverity;
  passed: boolean;
  message?: string;
}

export interface EvalRunResult {
  evalName: string;
  filePath: string;
  fixture: string;
  session: EvalSessionResult;
  assertions: EvalAssertion[];
  passed: boolean;
  durationMs: number;
}

export interface EvalConfig {
  /** Base URL of the running crew (local dev server or deployment). */
  baseUrl: string;
  /** Per-session timeout when calling POST /eval/session. */
  timeoutMs?: number;
}

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  baseUrl: 'http://localhost:3000',
  timeoutMs: 120_000,
};

export interface EvalDefinition {
  name: string;
  /** Fixture key sent to POST /eval/session. Defaults to eval name. */
  fixture?: string;
  run: (ctx: EvalContext) => void | Promise<void>;
}

/** Assertion helpers passed to defineEval run callbacks. */
export interface EvalContext {
  readonly session: EvalSessionResult;
  /** Gate assertion — session completed successfully. */
  succeeded(): void;
  /** Gate assertion with a custom predicate. */
  expect(condition: boolean, message: string): void;
  /** Soft assertions — fail only when --strict is set. */
  readonly soft: {
    expect(condition: boolean, message: string): void;
  };
  /** Collected assertions after run() completes. */
  readonly assertions: ReadonlyArray<EvalAssertion>;
}

export type EvalFixtureRunner = () => Promise<EvalSessionResult>;

export interface EvalServerOptions {
  fixtures: Record<string, EvalFixtureRunner>;
}
