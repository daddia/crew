import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatSkillCatalogSection,
  parseSkillMetadata,
  readSkillCatalog,
  resolveSkillsForTask,
} from '../src/skills.js';

describe('progressive skill loading', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'crew-skills-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, body: string, description?: string): Promise<string> {
    const dir = join(tempDir, 'plugin', 'skills', name);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    const frontmatter =
      description !== undefined ? `---\nname: ${name}\ndescription: ${description}\n---\n\n` : '';
    await writeFile(path, `${frontmatter}${body}`);
    return path;
  }

  it('parseSkillMetadata extracts description without returning the procedure body', () => {
    const metadata = parseSkillMetadata(
      `# Skill: assess-clarification

You are running this skill when \`context.task === "assess-clarification"\`.

Your job is to read the Jira ticket and decide whether it contains enough
information for you to implement it without making assumptions.

## Steps

### 1. Read the ticket
Long procedural content that must not appear in the catalog.`,
      '/persona/plugin/skills/assess-clarification/SKILL.md',
    );

    expect(metadata.name).toBe('assess-clarification');
    expect(metadata.tasks).toEqual(['assess-clarification']);
    expect(metadata.description).toContain('read the Jira ticket');
    expect(metadata.description).not.toContain('Long procedural content');
  });

  it('formatSkillCatalogSection advertises every skill description', async () => {
    const paths = await Promise.all([
      writeSkill('alpha', '# Alpha\n\nYour job is to do alpha work.', 'Alpha summary'),
      writeSkill('beta', '# Beta\n\nYour job is to do beta work.', 'Beta summary'),
      writeSkill('gamma', '# Gamma\n\nYour job is to do gamma work.', 'Gamma summary'),
      writeSkill('delta', '# Delta\n\nYour job is to do delta work.', 'Delta summary'),
      writeSkill(
        'assess-clarification',
        'You are running this skill when `context.task === "assess-clarification"`.\n\nYour job is to clarify tickets.',
        'Clarify whether a ticket is ready to implement',
      ),
    ]);

    const catalog = await readSkillCatalog(paths);
    const section = formatSkillCatalogSection(catalog);

    expect(catalog).toHaveLength(5);
    expect(section).toContain('## Available skills');
    expect(section).toContain('**assess-clarification**');
    expect(section).toContain('Clarify whether a ticket is ready to implement');
    expect(section).toContain('**alpha**');
    expect(section).not.toContain('Long procedural content');
  });

  it('Gherkin: unused skills do not inflate the initial prompt', async () => {
    const paths = await Promise.all([
      writeSkill('implement-story', '# implement\n\nBody for implement.', 'Implement stories'),
      writeSkill('fix-ci', '# fix-ci\n\nBody for fix-ci.', 'Fix CI failures'),
      writeSkill('address-feedback', '# feedback\n\nBody for feedback.', 'Address review feedback'),
      writeSkill('run-task', '# run\n\nBody for run.', 'Generic run task'),
      writeSkill(
        'assess-clarification',
        'You are running this skill when `context.task === "assess-clarification"`.\n\nYour job is to clarify tickets only.',
        'Clarify whether a ticket is ready to implement',
      ),
    ]);

    const catalog = await readSkillCatalog(paths);
    const namespaced = paths.map((p) => {
      const name = p.split('/skills/')[1]?.split('/')[0] ?? '';
      return `engineer:${name}`;
    });

    const active = resolveSkillsForTask('assess-clarification', catalog, namespaced);
    const section = formatSkillCatalogSection(catalog);

    expect(active).toEqual(['engineer:assess-clarification']);
    expect(section).toContain('**fix-ci**');
    expect(section).not.toContain('Body for fix-ci');
    expect(section).not.toContain('Body for implement');
  });
});
