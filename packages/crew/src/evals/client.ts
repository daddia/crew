import type { EvalConfig, EvalSessionResult } from './types.js';

export class EvalClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalClientError';
  }
}

export interface RunEvalSessionOptions {
  config: EvalConfig;
  fixture: string;
}

/** Drive a fixture session against a crew's POST /eval/session endpoint. */
export async function runEvalSession(options: RunEvalSessionOptions): Promise<EvalSessionResult> {
  const { config, fixture } = options;
  const url = new URL('/eval/session', config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new EvalClientError(
        `POST /eval/session failed (${response.status}): ${bodyText || response.statusText}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      throw new EvalClientError('POST /eval/session returned non-JSON body');
    }

    return parseSessionResult(parsed);
  } catch (err) {
    if (err instanceof EvalClientError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EvalClientError(`POST /eval/session timed out after ${timeoutMs}ms`);
    }
    throw new EvalClientError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

function parseSessionResult(value: unknown): EvalSessionResult {
  if (typeof value !== 'object' || value === null) {
    throw new EvalClientError('Invalid session result: expected object');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['success'] !== 'boolean') {
    throw new EvalClientError('Invalid session result: success must be boolean');
  }
  if (typeof obj['summary'] !== 'string') {
    throw new EvalClientError('Invalid session result: summary must be string');
  }
  if (typeof obj['costUsd'] !== 'number') {
    throw new EvalClientError('Invalid session result: costUsd must be number');
  }
  const artefacts =
    typeof obj['artefacts'] === 'object' &&
    obj['artefacts'] !== null &&
    !Array.isArray(obj['artefacts'])
      ? (obj['artefacts'] as Record<string, unknown>)
      : {};
  const sessionId = typeof obj['sessionId'] === 'string' ? obj['sessionId'] : undefined;
  return {
    success: obj['success'],
    summary: obj['summary'],
    artefacts,
    costUsd: obj['costUsd'],
    sessionId,
  };
}
