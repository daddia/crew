/**
 * Deterministic Jira API calls used by the workflow orchestrator.
 *
 * Full implementation: CREW-06-06. Agents use MCP for Jira access.
 */

export interface JiraClient {
  /** Returns `true` when the transition was applied, `false` when unavailable. */
  transitionIssue(issueKey: string, targetStatusName: string): Promise<boolean>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  commentOnIssue(issueKey: string, body: string): Promise<void>;
}

export interface JiraIssue {
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
  parentKey?: string;
}

export class JiraApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'JiraApiError';
  }
}
