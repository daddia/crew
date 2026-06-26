import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

/** Shared plugin bundles shipped with `@daddia/crew`. */
export type SharedPluginName = 'code-review';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directory name for persona-local SDK plugin bundles. */
export const PERSONA_PLUGIN_DIR = 'plugin';

/** Absolute path to the shared code-review plugin bundle. */
export const CODE_REVIEW_PLUGIN_PATH = join(PACKAGE_ROOT, 'plugins', 'code-review');

const SHARED_PLUGIN_PATHS: Record<SharedPluginName, string> = {
  'code-review': CODE_REVIEW_PLUGIN_PATH,
};

export interface ResolvedPlugin {
  config: SdkPluginConfig;
  /** Plugin name from manifest or directory basename. */
  name: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPluginName(pluginPath: string): Promise<string> {
  const manifestPath = join(pluginPath, '.claude-plugin', 'plugin.json');
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    if (typeof parsed.name === 'string' && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    // manifest optional — fall back to directory name
  }
  return basename(pluginPath);
}

/** Build an SDK local-plugin reference for a shared bundle. */
export async function sharedPluginRef(name: SharedPluginName): Promise<ResolvedPlugin> {
  const path = SHARED_PLUGIN_PATHS[name];
  return {
    config: { type: 'local', path, skipMcpDiscovery: true },
    name: await readPluginName(path),
  };
}

/** Resolve a persona's local plugin bundle when `plugin/` exists beside the prompt. */
export async function personaPluginRef(personaDir: string): Promise<ResolvedPlugin | null> {
  const path = join(personaDir, PERSONA_PLUGIN_DIR);
  if (!(await pathExists(path))) {
    return null;
  }
  return {
    config: { type: 'local', path, skipMcpDiscovery: true },
    name: await readPluginName(path),
  };
}

/** Namespace a skill for the SDK `skills` option (`plugin-name:skill-name`). */
export function namespacedSkillName(pluginName: string, skillName: string): string {
  return `${pluginName}:${skillName}`;
}

/**
 * Map absolute `.../skill-name/SKILL.md` paths to namespaced SDK skill names
 * using the plugin that owns each path.
 */
export function namespacedSkillNamesFromPaths(
  pluginName: string,
  skillPaths: string[],
): string[] {
  return skillPaths.map((p) => namespacedSkillName(pluginName, basename(dirname(p))));
}

/** Assemble persona + shared plugin bundles for a session. */
export async function resolvePluginBundles(options: {
  personaDir: string;
  skillPaths: string[];
  sharedPlugins?: SharedPluginName[];
}): Promise<{
  plugins: SdkPluginConfig[];
  skillNames: string[];
}> {
  const plugins: SdkPluginConfig[] = [];
  const skillNames: string[] = [];

  const persona = await personaPluginRef(options.personaDir);
  if (persona) {
    plugins.push(persona.config);
    const skillsRoot = join(persona.config.path, 'skills');
    const personaSkillPaths = options.skillPaths.filter((p) => p.startsWith(skillsRoot));
    skillNames.push(...namespacedSkillNamesFromPaths(persona.name, personaSkillPaths));
  }

  for (const shared of options.sharedPlugins ?? []) {
    const resolved = await sharedPluginRef(shared);
    plugins.push(resolved.config);
    if (shared === 'code-review') {
      skillNames.push(namespacedSkillName(resolved.name, 'code-review'));
    }
  }

  return { plugins, skillNames };
}
