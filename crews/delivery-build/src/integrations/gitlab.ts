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

export class GitLabUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitLabUrlError";
  }
}

/**
 * Parse the MR IID from a GitLab web URL, asserting the URL's project path
 * matches the expected project ID. Throws GitLabUrlError on mismatch or when
 * the URL has no `/merge_requests/{n}` segment.
 *
 * Numeric-only project IDs (e.g. "12345") bypass the path check because the
 * URL always carries the human-readable path and we cannot derive one from
 * the other without an API round-trip.
 */
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

/**
 * Create a GitLab API client bound to the given identity and credentials.
 * All requests use the API URL, project ID, and access token supplied at
 * construction time.
 *
 * The optional `behaviour` argument caps `getMrDiff()` output by file count
 * (`diffFileCap`, default 50) and total byte size (`diffSizeCapBytes`,
 * default 500 000) to avoid feeding oversized diffs to the agent personas.
 */
export function createGitlabClient(
  identity: { apiUrl: string; projectId: string },
  secrets: { gitlabAccessToken: string },
  behaviour: { diffFileCap: number; diffSizeCapBytes: number } = {
    diffFileCap: 50,
    diffSizeCapBytes: 500_000,
  },
): GitlabClient {
  const { apiUrl, projectId } = identity;
  const token = secrets.gitlabAccessToken;

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

  return {
    async createMr(options) {
      const { branchName, title, targetBranch = "main" } = options;

      const lookupRes = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests?source_branch=${encodeURIComponent(branchName)}&state=opened`,
      );
      const existing = (await lookupRes.json()) as Array<{ web_url: string }>;
      if (existing.length > 0) {
        return existing[0]!.web_url;
      }

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
      const iid = extractMrIid(projectId, mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/pipelines`,
      );
      const pipelines = (await res.json()) as Array<{ status: PipelineStatus }>;
      return pipelines[0]?.status ?? "pending";
    },

    async getMrDiff(mrWebUrl) {
      const iid = extractMrIid(projectId, mrWebUrl);
      const res = await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/diffs`,
      );
      const diffs = (await res.json()) as Array<{ diff: string; new_path: string }>;
      const { diffFileCap, diffSizeCapBytes } = behaviour;

      let parts = diffs;
      let fileNote = "";
      if (diffs.length > diffFileCap) {
        const omitted = diffs.length - diffFileCap;
        parts = diffs.slice(0, diffFileCap);
        fileNote = `\n[${omitted} files omitted — diff truncated at ${diffFileCap}]`;
      }

      let result = parts.map((d) => `--- ${d.new_path}\n${d.diff}`).join("\n\n") + fileNote;

      if (result.length > diffSizeCapBytes) {
        result = result.slice(0, diffSizeCapBytes) + `\n[diff truncated at ${diffSizeCapBytes} bytes]`;
      }

      return result;
    },

    async postReviewComment(mrWebUrl, body) {
      const iid = extractMrIid(projectId, mrWebUrl);
      await gitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/notes`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
    },
  };
}
