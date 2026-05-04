import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { log } from "./observability.js";

const MEMORY_FILENAME = "MEMORY.md";

function memoryPath(projectDir: string): string {
  return join(projectDir, ".claude", "agent-memory", "engineer", MEMORY_FILENAME);
}

async function buildSeedContent(projectDir: string): Promise<string> {
  const lines: string[] = [
    "# Project Memory",
    "",
    `Seeded: ${new Date().toISOString()}`,
    "",
  ];

  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    lines.push("## Language and tooling");
    lines.push("");

    // Detect TypeScript by checking for tsconfig.json rather than assuming.
    const hasTsconfig = await access(join(projectDir, "tsconfig.json"))
      .then(() => true)
      .catch(() => false);
    if (hasTsconfig) lines.push("- Language: TypeScript");

    if (typeof pkg["packageManager"] === "string") {
      const pm = (pkg["packageManager"] as string).split("@")[0] ?? "unknown";
      lines.push(`- Package manager: ${pm}`);
    }
    const devDeps = (pkg["devDependencies"] ?? {}) as Record<string, unknown>;
    if ("vitest" in devDeps) lines.push("- Test framework: Vitest");
    if ("turbo" in devDeps) lines.push("- Build system: Turborepo");
    lines.push("");
  } catch {
    // package.json not readable; skip section
  }

  try {
    const agentsRaw = await readFile(join(projectDir, "AGENTS.md"), "utf8");
    lines.push("## Conventions (from AGENTS.md)");
    lines.push("");
    // Truncate at a section boundary (H2 heading) after the first 30 lines so
    // the included block is always a complete markdown section.
    const agentsLines = agentsRaw.split("\n");
    let cutoff = agentsLines.length;
    for (let i = 30; i < Math.min(agentsLines.length, 80); i++) {
      if (agentsLines[i]?.startsWith("## ")) {
        cutoff = i;
        break;
      }
    }
    lines.push(...agentsLines.slice(0, cutoff));
    lines.push("");
  } catch {
    // AGENTS.md not readable; skip section
  }

  return lines.join("\n");
}

/**
 * Write an initial MEMORY.md into the engineer's project memory directory if
 * one does not already exist. Skips silently when memory is already present.
 * On write failure, logs a warn-level message and returns without throwing so
 * the workflow is never blocked by a memory seed error.
 */
export async function seedProjectMemory(projectDir: string): Promise<void> {
  const filePath = memoryPath(projectDir);

  try {
    await access(filePath);
    return; // already exists — skip
  } catch {
    // does not exist — proceed with seed
  }

  const content = await buildSeedContent(projectDir);

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    log.info("memory.seeded", { path: filePath });
  } catch (err) {
    log.warn("memory.seed-failed", {
      path: filePath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
