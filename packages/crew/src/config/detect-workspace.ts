import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Walk up the directory tree from startDir looking for a directory that
 * contains a `.crew/config` file. Returns the absolute path of the first
 * matching ancestor (or startDir itself). Behaves like git's root detection:
 * you can run from any subdirectory and still find the workspace.
 *
 * Throws if the filesystem root is reached without a match.
 */
export function detectWorkspace(startDir: string): string {
  let dir = resolve(startDir);

  while (true) {
    if (existsSync(join(dir, '.crew', 'config'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No workspace found. Searched from '${startDir}' to filesystem root for .crew/config. ` +
          `Run from within a workspace directory or pass an explicit startDir to detectWorkspace().`,
      );
    }
    dir = parent;
  }
}
