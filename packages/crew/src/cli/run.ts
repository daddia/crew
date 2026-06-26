import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectWorkspace } from '../config/detect-workspace.js';
import { resolveCrewDir } from '../evals/config.js';

export class RunCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunCliError';
  }
}

export interface RunStoryCliOptions {
  cwd?: string;
  crewName?: string;
  fixture: string;
  mode?: 'mock' | 'live';
}

export interface RunStoryCliResult {
  exitCode: number;
  crewDir: string;
}

/**
 * Run a fixture story driver for a server-shaped crew.
 * Invokes crews/{name}/dist/fixtures/run-cli.js — no live Jira board required.
 */
export async function runStoryCli(options: RunStoryCliOptions): Promise<RunStoryCliResult> {
  const cwd = options.cwd ?? process.cwd();
  let workspaceRoot: string;
  try {
    workspaceRoot = detectWorkspace(cwd);
  } catch {
    workspaceRoot = cwd;
  }

  const crewDir = resolveCrewDir(workspaceRoot, options.crewName);
  const driverPath = join(crewDir, 'dist', 'fixtures', 'run-cli.js');

  try {
    await access(driverPath);
  } catch {
    throw new RunCliError(
      `Story driver not built at ${driverPath}. Run pnpm build in the crew package first.`,
    );
  }

  const argv = [options.fixture];
  if (options.mode) {
    argv.push('--mode', options.mode);
  }

  const mod = await import(pathToFileURL(driverPath).href) as {
    runStoryFixtureCli: (argv: string[]) => Promise<number>;
  };

  if (typeof mod.runStoryFixtureCli !== 'function') {
    throw new RunCliError(`Story driver at ${driverPath} does not export runStoryFixtureCli`);
  }

  const exitCode = await mod.runStoryFixtureCli(argv);
  return { exitCode, crewDir };
}
