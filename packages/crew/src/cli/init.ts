import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { detectWorkspace } from '../config/detect-workspace.js';
import { packageRoot, runtimeVersion } from './package-root.js';
import { renderTemplateTree } from './render-template.js';
import type { CrewShape } from './parse-args.js';

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitError';
  }
}

export interface InitCrewOptions {
  name: string;
  shape: CrewShape;
  cwd?: string;
}

export interface InitCrewResult {
  targetDir: string;
  shape: CrewShape;
  runtimeVersion: string;
}

/**
 * Scaffold a new crew under `crews/{name}/` in the detected workspace.
 */
export async function initCrew(options: InitCrewOptions): Promise<InitCrewResult> {
  const cwd = options.cwd ?? process.cwd();
  const workspaceRoot = detectWorkspace(cwd);
  const targetDir = join(workspaceRoot, 'crews', options.name);
  const version = runtimeVersion();
  const templateDir = join(packageRoot(), 'templates', options.shape);

  try {
    await access(targetDir);
    throw new InitError(`Crew directory already exists: ${targetDir}`);
  } catch (err) {
    if (err instanceof InitError) {
      throw err;
    }
    // ENOENT — proceed
  }

  try {
    await access(templateDir);
  } catch {
    throw new InitError(`Template not found for shape "${options.shape}": ${templateDir}`);
  }

  const vars = {
    crewName: options.name,
    packageName: `@daddia/crew-${options.name}`,
    crewId: options.name,
    runtimeVersion: version,
  };

  await renderTemplateTree(templateDir, targetDir, vars);

  return { targetDir, shape: options.shape, runtimeVersion: version };
}
