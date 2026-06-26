import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StoryFixture } from './types.js';

const JiraIssueSchema = z.object({
  summary: z.string(),
  description: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  parentKey: z.string().optional(),
});

const EngineerStepSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  artefacts: z.record(z.string(), z.unknown()),
});

const StoryFixtureSchema = z.object({
  issueKey: z.string().min(1),
  jira: z.object({
    issue: JiraIssueSchema,
    parentIssue: JiraIssueSchema.optional(),
  }),
  gitlab: z.object({
    pipelineStatus: z.enum(['created', 'pending', 'running', 'success', 'failed', 'canceled']),
    mrUrl: z.string().url(),
  }),
  engineer: z.object({
    assess: EngineerStepSchema,
    implement: EngineerStepSchema,
  }),
});

export class StoryFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryFixtureError';
  }
}

/** Resolve fixtures/{issueKey}/ under the crew package root. */
export function resolveFixtureDir(crewRoot: string, issueKey: string): string {
  return join(crewRoot, 'fixtures', issueKey);
}

/** Load and validate a story fixture from fixtures/{issueKey}/fixture.json. */
export async function loadStoryFixture(crewRoot: string, issueKey: string): Promise<StoryFixture> {
  const fixturePath = join(resolveFixtureDir(crewRoot, issueKey), 'fixture.json');
  let raw: string;
  try {
    raw = await readFile(fixturePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new StoryFixtureError(`Fixture not found: ${fixturePath}`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new StoryFixtureError(`Invalid JSON in fixture: ${fixturePath}`);
  }

  const result = StoryFixtureSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new StoryFixtureError(`Invalid fixture schema at ${fixturePath}: ${detail}`);
  }

  if (result.data.issueKey !== issueKey) {
    throw new StoryFixtureError(
      `Fixture issueKey "${result.data.issueKey}" does not match directory "${issueKey}"`,
    );
  }

  return result.data;
}
