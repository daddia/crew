import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { Violation } from '../types.js';

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;

async function collectSourceFiles(dir: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await collectSourceFiles(full, acc);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
}

function crewNameFromPath(filePath: string, crewsDir: string): string | undefined {
  const rel = relative(crewsDir, filePath);
  const match = /^([^/]+)\//.exec(rel);
  return match?.[1];
}

function resolvesToOtherCrew(
  specifier: string,
  filePath: string,
  crewsDir: string,
  ownCrew: string,
): boolean {
  if (specifier.startsWith('@daddia/crew-')) {
    const importedCrew = specifier.slice('@daddia/crew-'.length).split('/')[0] ?? '';
    return importedCrew.length > 0 && importedCrew !== ownCrew;
  }

  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolved = resolve(dirname(filePath), specifier);
  const relToCrews = relative(crewsDir, resolved);
  if (relToCrews.startsWith('..')) {
    return false;
  }

  const importedCrew = relToCrews.split('/')[0];
  return importedCrew !== undefined && importedCrew !== ownCrew;
}

/** Crew source must not import from another crew package or relative path. */
export async function checkCrossCrewImports(crewsDir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const files: string[] = [];
  await collectSourceFiles(crewsDir, files);

  for (const filePath of files) {
    if (!filePath.includes('/src/')) continue;
    const ownCrew = crewNameFromPath(filePath, crewsDir);
    if (!ownCrew) continue;

    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const match of line.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];
        if (!specifier || !resolvesToOtherCrew(specifier, filePath, crewsDir, ownCrew)) continue;
        violations.push({
          ruleId: 'no-cross-crew-imports',
          filePath,
          line: i + 1,
          message: `Import from another crew is forbidden: ${specifier}`,
        });
      }
    }
  }

  return violations;
}
