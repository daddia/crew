import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { packageRoot } from '../cli/package-root.js';

const CACHE_DIR = join(tmpdir(), 'crew-eval-import-cache');

/** Dynamic import for crew-authored TypeScript modules (eval files, config). */
export async function importTypeScriptModule<T>(filePath: string): Promise<T> {
  const source = await readFile(filePath, 'utf8');
  const result = buildSync({
    entryPoints: [filePath],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    packages: 'bundle',
    alias: {
      '@daddia/crew/evals': join(packageRoot(), 'dist/evals/define-eval.js'),
    },
  });

  const code = result.outputFiles[0]?.text;
  if (!code) {
    throw new Error(`Failed to bundle TypeScript module: ${filePath}`);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const hash = createHash('sha256').update(filePath).update(code).digest('hex').slice(0, 16);
  const outPath = join(CACHE_DIR, `${basename(filePath, '.ts')}-${hash}.mjs`);
  await writeFile(outPath, code);
  return (await import(pathToFileURL(outPath).href)) as T;
}
