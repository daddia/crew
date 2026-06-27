/**
 * Deterministic GitLab API calls used by the workflow orchestrator.
 *
 * Full implementation: CREW-06-05.
 */

export type PipelineStatus = 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled';

export interface GitlabClient {
  /** Resolve an open MR whose source branch contains the issue key. */
  findOpenMrForIssue(issueKey: string): Promise<string | null>;
  getPipelineStatus(mrWebUrl: string): Promise<PipelineStatus>;
  getMrSourceBranch(mrWebUrl: string): Promise<string>;
  getMrDiff(mrWebUrl: string): Promise<string>;
  approveMergeRequest(mrWebUrl: string): Promise<void>;
  /** Returns the merge commit SHA; project merge method applies. */
  mergeMergeRequest(mrWebUrl: string): Promise<string>;
}

export class GitLabApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'GitLabApiError';
  }
}

export class GitLabUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitLabUrlError';
  }
}
