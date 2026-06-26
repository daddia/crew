#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '../..');
const docsOut = join(packageRoot, 'docs');

/** @type {Array<[string, string]>} */
const COPIES = [
  [join(repoRoot, 'AGENTS.md'), 'AGENTS.md'],
  [join(repoRoot, 'contributing/adding-a-persona.md'), 'adding-a-persona.md'],
  [join(repoRoot, 'contributing/adding-an-agent-crew.md'), 'adding-an-agent-crew.md'],
];

const SOLUTION_START = '### 4.2 Crew layouts';
const SOLUTION_END = '## 5. Runtime view';

async function extractSolutionSummary() {
  const solutionPath = join(repoRoot, 'docs/architecture/solution.md');
  const content = await readFile(solutionPath, 'utf8');
  const start = content.indexOf(SOLUTION_START);
  const end = content.indexOf(SOLUTION_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `Could not extract solution summary from ${solutionPath} (${SOLUTION_START} → ${SOLUTION_END})`,
    );
  }
  const excerpt = content.slice(start, end).trim();
  const header = [
    '# Solution summary (excerpt)',
    '',
    'Bundled from `docs/architecture/solution.md` — crew layouts and filesystem authoring model.',
    '',
  ].join('\n');
  return `${header}\n${excerpt}\n`;
}

async function bundleDocs() {
  await mkdir(docsOut, { recursive: true });
  for (const [src, dest] of COPIES) {
    await copyFile(src, join(docsOut, dest));
  }
  await writeFile(join(docsOut, 'solution-summary.md'), await extractSolutionSummary());
}

await bundleDocs();
