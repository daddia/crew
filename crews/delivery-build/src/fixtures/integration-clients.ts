import type { StoryFixture } from './types.js';
import type { GitlabClient } from '../integrations/gitlab.js';
import type { JiraClient, JiraComment } from '../integrations/jira.js';

export interface RecordingFixtureClients {
  jira: JiraClient & {
    transitions: string[];
    comments: string[];
  };
  gitlab: GitlabClient;
}

/** Build workflow Jira/GitLab clients backed by fixture JSON — no live credentials. */
export function createFixtureIntegrationClients(fixture: StoryFixture): RecordingFixtureClients {
  const transitions: string[] = [];
  const comments: string[] = [];

  const jira: RecordingFixtureClients['jira'] = {
    transitions,
    comments,
    transitionIssue: async (_issueKey, status) => {
      transitions.push(status);
      return true;
    },
    commentOnIssue: async (_issueKey, body) => {
      comments.push(body);
    },
    getIssue: async (issueKey) => {
      if (fixture.jira.parentIssue && issueKey === fixture.jira.issue.parentKey) {
        return fixture.jira.parentIssue;
      }
      if (issueKey === fixture.issueKey) {
        return fixture.jira.issue;
      }
      throw new Error(`Fixture has no Jira issue for key: ${issueKey}`);
    },
    searchIssues: async () => [],
    getComments: async (): Promise<JiraComment[]> => [],
  };

  const gitlab: GitlabClient = {
    createMr: async () => fixture.gitlab.mrUrl,
    getPipelineStatus: async () => fixture.gitlab.pipelineStatus,
    getMrDiff: async () => '',
    postReviewComment: async () => {},
    getMrSourceBranch: async () => {
      const branch = fixture.engineer.implement.artefacts['branchName'];
      return typeof branch === 'string' ? branch : `feature/${fixture.issueKey}-fixture`;
    },
  };

  return { jira, gitlab };
}
