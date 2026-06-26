#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runFixtureStory } from './story-driver.js';
import { StoryFixtureError } from './load-fixture.js';
import type { StoryFixtureMode } from './types.js';

function parseArgs(argv: string[]): { issueKey: string; mode?: StoryFixtureMode } {
  let issueKey: string | undefined;
  let mode: StoryFixtureMode | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === '--mode') {
      const value = argv[i + 1];
      if (value !== 'mock' && value !== 'live') {
        throw new Error('--mode must be "mock" or "live"');
      }
      mode = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!issueKey) {
      issueKey = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!issueKey) {
    throw new Error('Usage: dev:story <issueKey> [--mode mock|live]');
  }

  return { issueKey, mode };
}

export async function runStoryFixtureCli(argv: string[]): Promise<number> {
  const { issueKey, mode } = parseArgs(argv);
  const result = await runFixtureStory({ issueKey, mode });

  const lines = [
    `issueKey: ${result.issueKey}`,
    `mode: ${result.mode}`,
    `success: ${result.success}`,
    `terminalStep: ${result.terminalStep}`,
    `jiraTransitions: ${result.jiraTransitions.join(' → ') || '(none)'}`,
    ...(result.implementSessionId ? [`implementSessionId: ${result.implementSessionId}`] : []),
    `summary: ${result.summary}`,
  ];

  process.stdout.write(lines.join('\n') + '\n');
  return result.success ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStoryFixtureCli(process.argv.slice(2)).catch((err: unknown) => {
    if (err instanceof StoryFixtureError) {
      process.stderr.write(`story fixture: ${err.message}\n`);
      process.exit(1);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`story fixture: ${message}\n`);
    process.exit(1);
  });
}
