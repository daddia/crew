import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(packageRoot, 'docs');
const bundleScript = join(packageRoot, 'scripts', 'bundle-docs.mjs');

describe('bundled runtime docs', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [bundleScript], { cwd: packageRoot });
  });

  afterAll(async () => {
    await rm(docsDir, { recursive: true, force: true });
  });

  it('copies AGENTS.md and contributor guides into docs/', async () => {
    await expect(readFile(join(docsDir, 'AGENTS.md'), 'utf8')).resolves.toContain(
      'Code conventions',
    );
    await expect(readFile(join(docsDir, 'adding-a-persona.md'), 'utf8')).resolves.toContain(
      'Adding a Persona',
    );
    await expect(readFile(join(docsDir, 'adding-an-agent-crew.md'), 'utf8')).resolves.toMatch(
      /agent crew/i,
    );
  });

  it('includes a solution summary excerpt', async () => {
    const summary = await readFile(join(docsDir, 'solution-summary.md'), 'utf8');
    expect(summary).toContain('Filesystem authoring model');
    expect(summary).toContain('Bundled documentation');
  });

  it('lists docs in the npm pack tarball', async () => {
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    const [packMeta] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const paths = packMeta.files.map((file) => file.path);
    expect(paths).toContain('docs/AGENTS.md');
    expect(paths).toContain('docs/adding-a-persona.md');
  });
});
