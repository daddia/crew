import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStoryFixture } from '../src/fixtures/load-fixture.js';
import { createFixtureIntegrationClients } from '../src/fixtures/integration-clients.js';
import { runFixtureStory, resolveCrewRoot } from '../src/fixtures/story-driver.js';

const crewRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('story fixture CREW-123', () => {
  it('loads fixture.json with mocked Jira/GitLab responses', async () => {
    const fixture = await loadStoryFixture(crewRoot, 'CREW-123');

    expect(fixture.issueKey).toBe('CREW-123');
    expect(fixture.jira.issue.summary).toContain('fixture story driver');
    expect(fixture.jira.parentIssue?.summary).toContain('Platform Authoring');
  });

  it('integration clients serve fixture data without live credentials', async () => {
    const fixture = await loadStoryFixture(crewRoot, 'CREW-123');
    const { jira } = createFixtureIntegrationClients(fixture);

    const issue = await jira.getIssue('CREW-123');
    expect(issue.summary).toBe(fixture.jira.issue.summary);

    const parentKey = fixture.jira.issue.parentKey;
    expect(parentKey).toBeDefined();
    const parent = await jira.getIssue(parentKey!);
    expect(parent.summary).toBe(fixture.jira.parentIssue?.summary);

    await jira.transitionIssue('CREW-123', 'In Progress');
    expect(jira.transitions).toEqual(['In Progress']);
  });

  it('story driver runs implement with mock engineer (offline)', async () => {
    const result = await runFixtureStory({
      issueKey: 'CREW-123',
      mode: 'mock',
      crewRoot,
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('mock');
    expect(result.terminalStep).toBe('implement');
    expect(result.implementSessionId).toBe('fixture-crew-123-implement');
    expect(result.jiraTransitions).toContain('In Progress');
  });

  it('resolveCrewRoot points at delivery-build package root', () => {
    expect(resolveCrewRoot()).toBe(crewRoot);
    expect(join(resolveCrewRoot(), 'fixtures', 'CREW-123', 'fixture.json')).toContain('CREW-123');
  });
});
