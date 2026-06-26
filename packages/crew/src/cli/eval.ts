import { detectWorkspace } from '../config/detect-workspace.js';
import { resolveCrewDir } from '../evals/config.js';
import { formatEvalResult, runEvalSuite, EvalRunnerError } from '../evals/runner.js';
import { writeJUnitReport } from '../evals/reporters/junit.js';
import type { EvalRunResult } from '../evals/types.js';

export class EvalCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalCliError';
  }
}

export interface RunEvalCliOptions {
  cwd?: string;
  crewName?: string;
  files?: string[];
  baseUrl?: string;
  strict?: boolean;
  reporter?: 'text' | 'junit';
  output?: string;
}

export interface RunEvalCliResult {
  results: EvalRunResult[];
  exitCode: number;
  outputPath?: string;
}

/**
 * Execute CrewBench evals for a crew directory.
 * Targets the crew HTTP surface at baseUrl (local dev server or deployment).
 */
export async function runEvalCli(options: RunEvalCliOptions): Promise<RunEvalCliResult> {
  const cwd = options.cwd ?? process.cwd();
  let workspaceRoot: string;
  try {
    workspaceRoot = detectWorkspace(cwd);
  } catch {
    workspaceRoot = cwd;
  }

  const crewDir = resolveCrewDir(workspaceRoot, options.crewName, options.files);
  const reporter = options.reporter ?? 'text';
  const outputPath = options.output ?? 'junit.xml';

  let results: EvalRunResult[];
  try {
    results = await runEvalSuite({
      crewDir,
      files: options.files,
      baseUrl: options.baseUrl,
      strict: options.strict,
    });
  } catch (err) {
    if (err instanceof EvalRunnerError) {
      throw new EvalCliError(err.message);
    }
    throw err;
  }

  const failed = results.some((r) => !r.passed);

  if (reporter === 'junit') {
    await writeJUnitReport(results, outputPath);
    process.stdout.write(`JUnit report written to ${outputPath}\n`);
  } else {
    for (const result of results) {
      process.stdout.write(`${formatEvalResult(result)}\n`);
    }
  }

  return {
    results,
    exitCode: failed ? 1 : 0,
    outputPath: reporter === 'junit' ? outputPath : undefined,
  };
}
