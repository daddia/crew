import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_EVAL_CONFIG, type EvalConfig } from './types.js';
import { importTypeScriptModule } from './import-module.js';

const CONFIG_FILENAMES = ['evals.config.ts', 'evals.config.js', 'evals.config.mjs'] as const;

/** Strip a path suffix from `/evals/…` without regex backtracking on user input. */
function crewDirFromEvalPath(absolute: string): string | undefined {
  const normalized = absolute.replace(/\\/g, '/');
  const marker = '/evals/';
  const markerIdx = normalized.lastIndexOf(marker);
  if (markerIdx >= 0) {
    return normalized.slice(0, markerIdx);
  }
  return undefined;
}

export interface LoadEvalConfigOptions {
  crewDir: string;
  baseUrlOverride?: string;
}

/** Load evals.config.ts from a crew directory, merging CLI overrides. */
export async function loadEvalConfig(options: LoadEvalConfigOptions): Promise<EvalConfig> {
  const { crewDir, baseUrlOverride } = options;
  let loaded: Partial<EvalConfig> = {};

  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(crewDir, 'evals', filename);
    try {
      await access(configPath);
      const mod = await importTypeScriptModule<{ default?: Partial<EvalConfig> }>(configPath);
      loaded = mod.default ?? {};
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }

  const baseUrl =
    baseUrlOverride?.trim() ||
    process.env['CREW_EVAL_BASE_URL']?.trim() ||
    loaded.baseUrl?.trim() ||
    DEFAULT_EVAL_CONFIG.baseUrl;

  return {
    baseUrl,
    timeoutMs: loaded.timeoutMs ?? DEFAULT_EVAL_CONFIG.timeoutMs,
  };
}

export function resolveCrewDir(
  workspaceRoot: string,
  crewName?: string,
  hintPaths?: string[],
): string {
  if (crewName) {
    return resolve(workspaceRoot, 'crews', crewName);
  }

  for (const hint of hintPaths ?? []) {
    const absolute = resolve(hint);
    const crewsMatch = absolute.match(/crews[\\/]+([^\\/]+)[\\/]+evals[\\/]/);
    if (crewsMatch?.[1]) {
      return resolve(workspaceRoot, 'crews', crewsMatch[1]);
    }
    const evalParent = crewDirFromEvalPath(absolute);
    if (evalParent && existsSync(join(evalParent, 'evals'))) {
      return evalParent;
    }
  }

  const cwd = process.cwd();
  const cwdMatch = cwd.match(/crews[\\/]+([^\\/]+)(?:[\\/]|$)/);
  if (cwdMatch?.[1]) {
    const candidate = resolve(workspaceRoot, 'crews', cwdMatch[1]);
    if (existsSync(join(candidate, 'evals'))) {
      return candidate;
    }
  }

  for (const entry of ['delivery-build', 'delivery-code-review', 'delivery-review']) {
    const candidate = join(workspaceRoot, 'crews', entry);
    if (existsSync(join(candidate, 'evals'))) {
      return candidate;
    }
  }

  return workspaceRoot;
}
