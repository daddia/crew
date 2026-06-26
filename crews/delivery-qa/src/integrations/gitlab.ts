/**
 * Deterministic GitLab API calls used by the workflow orchestrator.
 */

export interface GitlabClient {
  getPipelineStatus(mrWebUrl: string): Promise<PipelineStatus>;
  getMrSourceBranch(mrWebUrl: string): Promise<string>;
  /** Resolve an open MR whose source branch contains the issue key. */
  findOpenMrForIssue(issueKey: string): Promise<string | null>;
}

export type PipelineStatus = 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled';

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

export function extractMrIid(expectedProjectId: string, webUrl: string): string {
  const match = webUrl.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!match) {
    throw new GitLabUrlError(`Cannot extract MR IID from URL: ${webUrl}`);
  }
  const urlProjectPath = decodeURIComponent(match[1] as string);
  if (!/^\d+$/.test(expectedProjectId) && urlProjectPath !== expectedProjectId) {
    throw new GitLabUrlError(
      `Project path mismatch: expected "${expectedProjectId}", received "${urlProjectPath}"`,
    );
  }
  return match[2] as string;
}

export function createGitlabClient(
  identity: { apiUrl: string; projectId: string },
  secrets: { gitlabAccessToken: string },
): GitlabClient {
  const { apiUrl, projectId } = identity;
  const token = secrets.gitlabAccessToken;

  async function gitlabFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitLabApiError(res.status, `${init?.method ?? 'GET'} ${path}: ${text}`);
    }
    return res;
  }

  return {
    async getPipelineStatus(mrWebUrl) {
      const iid = extractMrIid(projectId, mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/pipelines`,
      );
      const pipelines = (await res.json()) as Array<{ status: PipelineStatus }>;
      return pipelines[0]?.status ?? 'pending';
    },

    async getMrSourceBranch(mrWebUrl) {
      const iid = extractMrIid(projectId, mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}`,
      );
      const data = (await res.json()) as { source_branch: string };
      return data.source_branch;
    },

    async findOpenMrForIssue(issueKey) {
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened&search=${encodeURIComponent(issueKey)}`,
      );
      const mrs = (await res.json()) as Array<{ web_url: string; source_branch: string }>;
      const match = mrs.find((mr) => mr.source_branch.includes(issueKey));
      return match?.web_url ?? null;
    },
  };
}
