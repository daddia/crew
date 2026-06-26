import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  CODE_REVIEW_PLUGIN_PATH,
  namespacedSkillName,
  namespacedSkillNamesFromPaths,
  resolvePluginBundles,
  sharedPluginRef,
} from '../src/plugins.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'engineer');
const implementStorySkill = join(
  fixturesDir,
  'plugin',
  'skills',
  'implement-story',
  'SKILL.md',
);

describe('plugin helpers', () => {
  it('sharedPluginRef resolves the code-review bundle', async () => {
    const resolved = await sharedPluginRef('code-review');
    expect(resolved.name).toBe('code-review');
    expect(resolved.config).toMatchObject({
      type: 'local',
      path: CODE_REVIEW_PLUGIN_PATH,
      skipMcpDiscovery: true,
    });
  });

  it('namespacedSkillName prefixes plugin and skill', () => {
    expect(namespacedSkillName('code-review', 'code-review')).toBe('code-review:code-review');
    expect(namespacedSkillNamesFromPaths('engineer', [implementStorySkill])).toEqual([
      'engineer:implement-story',
    ]);
  });

  it('resolvePluginBundles assembles persona and shared plugins', async () => {
    const { plugins, skillNames } = await resolvePluginBundles({
      personaDir: fixturesDir,
      skillPaths: [implementStorySkill],
      sharedPlugins: ['code-review'],
    });

    expect(plugins).toHaveLength(2);
    expect(skillNames).toEqual(['engineer:implement-story', 'code-review:code-review']);
  });

  it('Gherkin: shared code-review skill is defined once for multiple consumers', async () => {
    const senior = await resolvePluginBundles({
      personaDir: '/nonexistent/senior-engineer',
      skillPaths: [join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'code-review', 'SKILL.md')],
      sharedPlugins: ['code-review'],
    });
    const cliCrew = await resolvePluginBundles({
      personaDir: '/nonexistent/code-reviewer',
      skillPaths: [join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'code-review', 'SKILL.md')],
      sharedPlugins: ['code-review'],
    });

    expect(senior.plugins[0]?.path).toBe(CODE_REVIEW_PLUGIN_PATH);
    expect(cliCrew.plugins[0]?.path).toBe(CODE_REVIEW_PLUGIN_PATH);
    expect(senior.skillNames).toEqual(['code-review:code-review']);
    expect(cliCrew.skillNames).toEqual(['code-review:code-review']);
  });
});
