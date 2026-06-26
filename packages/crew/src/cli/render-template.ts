import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface TemplateVars {
  crewName: string;
  packageName: string;
  crewId: string;
  runtimeVersion: string;
}

async function collectFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, base)));
    } else {
      files.push(full.slice(base.length + 1));
    }
  }
  return files.sort();
}

function renderContent(content: string, vars: TemplateVars): string {
  return content
    .replaceAll('{{CREW_NAME}}', vars.crewName)
    .replaceAll('{{PACKAGE_NAME}}', vars.packageName)
    .replaceAll('{{CREW_ID}}', vars.crewId)
    .replaceAll('{{RUNTIME_VERSION}}', vars.runtimeVersion);
}

/** Copy a template tree into targetDir, substituting {{PLACEHOLDER}} tokens. */
export async function renderTemplateTree(
  templateDir: string,
  targetDir: string,
  vars: TemplateVars,
): Promise<void> {
  const files = await collectFiles(templateDir);
  for (const relative of files) {
    const src = join(templateDir, relative);
    const dest = join(targetDir, relative);
    await mkdir(dirname(dest), { recursive: true });
    const raw = await readFile(src, 'utf8');
    await writeFile(dest, renderContent(raw, vars), 'utf8');
  }
}
