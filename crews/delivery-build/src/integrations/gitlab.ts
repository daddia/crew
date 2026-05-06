/**
 * Deterministic GitLab API calls used by the workflow orchestrator.
 *
 * Same separation note as integrations/jira.ts — these are not model calls.
 */

export interface GitlabClient {
  createMr(options: CreateMrOptions): Promise<string>;
  getPipelineStatus(mrWebUrl: string): Promise<PipelineStatus>;
  getMrDiff(mrWebUrl: string): Promise<string>;
  postReviewComment(mrWebUrl: string, body: string): Promise<void>;
}

export interface CreateMrOptions {
  issueKey: string;
  branchName: string;
  title: string;
  targetBranch?: string;
}

export type PipelineStatus =
  | "created"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled";

export class GitLabApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "GitLabApiError";
  }
}

/**
 * Create a GitLab API client bound to the given identity and credentials.
 * All requests use the API URL, project ID, and access token supplied at
 * construction time.
 */
export function createGitlabClient(
  identity: { apiUrl: string; projectId: string },
  secrets: { gitlabAccessToken: string },
): GitlabClient {
  const { apiUrl, projectId } = identity;
  const token = String(secrets.gitlabAccessToken);

  async function gitlabFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GitLabApiError(res.status, `${init?.method ?? "GET"} ${path}: ${text}`);
    }
    return res;
  }

  function extractMrIid(webUrl: string): string {
    const match = webUrl.match(/\/merge_requests\/(\d+)/);
    if (!match) throw new GitLabApiError(0, `Cannot extract MR IID from URL: ${webUrl}`);
    return match[1] as string;
  }

  return {
    async createMr(options) {
      const { branchName, title, targetBranch = "main" } = options;
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests`,
        {
          method: "POST",
          body: JSON.stringify({
            source_branch: branchName,
            target_branch: targetBranch,
            title,
            remove_source_branch: true,
          }),
        },
      );
      const data = (await res.json()) as { web_url: string };
      return data.web_url;
    },

    async getPipelineStatus(mrWebUrl) {
      const iid = extractMrIid(mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/pipelines`,
      );
      const pipelines = (await res.json()) as Array<{ status: PipelineStatus }>;
      return pipelines[0]?.status ?? "pending";
    },

    async getMrDiff(mrWebUrl) {
      const iid = extractMrIid(mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/diffs`,
      );
      const diffs = (await res.json()) as Array<{ diff: string; new_path: string }>;
      return diffs.map((d) => `--- ${d.new_path}\n${d.diff}`).join("\n\n");
    },

    async postReviewComment(mrWebUrl, body) {
      const iid = extractMrIid(mrWebUrl);
      await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/notes`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
    },
  };
}
