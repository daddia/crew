import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Canonical path for a persona's project memory file under
 * `<projectDir>/.claude/agent-memory/<personaName>/`.
 */
export function memoryPath(projectDir: string, personaName: string): string {
  return join(projectDir, '.claude', 'agent-memory', personaName, 'MEMORY.md');
}

/**
 * Write `content` into a persona's project memory file if one does not
 * already exist. Skips silently when the file is already present so the
 * workflow is never blocked by a repeat seed attempt.
 *
 * On write failure the error is returned so the caller can decide whether
 * to log and continue or to surface it. The function never throws.
 *
 * Usage:
 *   import { seedProjectMemory } from "@daddia/crew";
 *   const err = await seedProjectMemory(projectDir, "engineer", content);
 *   if (err) log.warn("memory.seed-failed", { err: err.message });
 */
export async function seedProjectMemory(
  projectDir: string,
  personaName: string,
  content: string,
): Promise<Error | null> {
  const filePath = memoryPath(projectDir, personaName);

  try {
    await access(filePath);
    return null; // already exists — skip
  } catch {
    // does not exist — proceed
  }

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}
