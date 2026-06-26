import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { runEvalSession } from './client.js';
import { createEvalContext, evalPassed } from './context.js';
import { loadEvalConfig } from './config.js';
import { importTypeScriptModule } from './import-module.js';
import type { EvalDefinition, EvalRunResult } from './types.js';

export class EvalRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalRunnerError';
  }
}

export interface RunEvalFileOptions {
  filePath: string;
  crewDir: string;
  baseUrl?: string;
  strict?: boolean;
}

export interface RunEvalSuiteOptions {
  crewDir: string;
  files?: string[];
  baseUrl?: string;
  strict?: boolean;
}

async function loadEvalDefinition(filePath: string): Promise<EvalDefinition> {
  const mod = await importTypeScriptModule<{ default?: EvalDefinition }>(filePath);
  const definition = mod.default;
  if (!definition || typeof definition.run !== 'function') {
    throw new EvalRunnerError(`${filePath} must default-export defineEval({ ... })`);
  }
  return definition;
}

/** Run a single eval file against a crew base URL. */
export async function runEvalFile(options: RunEvalFileOptions): Promise<EvalRunResult> {
  const started = Date.now();
  const filePath = resolve(options.filePath);
  const config = await loadEvalConfig({
    crewDir: options.crewDir,
    baseUrlOverride: options.baseUrl,
  });

  const definition = await loadEvalDefinition(filePath);
  const fixture = definition.fixture ?? definition.name;
  const session = await runEvalSession({ config, fixture });
  const ctx = createEvalContext(session);
  await definition.run(ctx);

  const assertions = ctx.assertions;
  const passed = evalPassed(assertions, options.strict ?? false);

  return {
    evalName: definition.name,
    filePath,
    fixture,
    session,
    assertions,
    passed,
    durationMs: Date.now() - started,
  };
}

/** Discover and run eval files under a crew's evals/ directory. */
export async function runEvalSuite(options: RunEvalSuiteOptions): Promise<EvalRunResult[]> {
  const crewDir = resolve(options.crewDir);
  const evalsDir = join(crewDir, 'evals');

  let files = options.files?.map((f) => resolve(f));
  if (!files || files.length === 0) {
    const entries = await readdir(evalsDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.eval.ts'))
      .map((e) => join(evalsDir, e.name))
      .sort((a, b) => a.localeCompare(b));
  }

  if (files.length === 0) {
    throw new EvalRunnerError(`No eval files found under ${evalsDir}`);
  }

  const results: EvalRunResult[] = [];
  for (const filePath of files) {
    results.push(
      await runEvalFile({
        filePath,
        crewDir,
        baseUrl: options.baseUrl,
        strict: options.strict,
      }),
    );
  }
  return results;
}

export function formatEvalResult(result: EvalRunResult): string {
  const status = result.passed ? 'PASS' : 'FAIL';
  const lines = [`${status} ${result.evalName} (${basename(result.filePath)})`];
  for (const assertion of result.assertions) {
    if (!assertion.passed) {
      const tag = assertion.severity === 'soft' ? 'soft' : 'gate';
      lines.push(
        `  ✗ [${tag}] ${assertion.name}${assertion.message ? `: ${assertion.message}` : ''}`,
      );
    }
  }
  if (!result.passed && result.assertions.every((a) => a.passed)) {
    lines.push(`  session success=${result.session.success}`);
  }
  return lines.join('\n');
}
