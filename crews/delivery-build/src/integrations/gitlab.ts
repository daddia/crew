/**
 * Deterministic GitLab SDK calls used by the workflow orchestrator.
 *
 * Same separation note as integrations/jira.ts — these are not model calls.
 */

const API_URL = process.env["GITLAB_API_URL"] ?? "https://gitlab.com/api/v4";
const TOKEN = process.env["GITLAB_PERSONAL_ACCESS_TOKEN"] ?? "";
const PROJECT_ID = process.env["GITLAB_PROJECT_ID"] ?? "";

async function gitlabFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GitLabApiError(
      res.status,
      `${init?.method ?? "GET"} ${path}: ${text}`,
    );
  }
  return res;
}

export interface CreateMrOptions {
  issueKey: string;
  branchName: string;
  title: string;
  targetBranch?: string;
}

/**
 * Create a merge request and return its web URL.
 */
export async function createMr(options: CreateMrOptions): Promise<string> {
  const { branchName, title, targetBranch = "main" } = options;

  const res = await gitlabFetch(`/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests`, {
    method: "POST",
    body: JSON.stringify({
      source_branch: branchName,
      target_branch: targetBranch,
      title,
      remove_source_branch: true,
    }),
  });

  const data = (await res.json()) as { web_url: string };
  return data.web_url;
}

export type PipelineStatus =
  | "created"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled";

/**
 * Return the status of the most recently created pipeline for an MR.
 * Returns "pending" when no pipeline has been created yet so the caller
 * treats it as a transient state and retries.
 */
export async function getPipelineStatus(mrWebUrl: string): Promise<PipelineStatus> {
  const iid = extractMrIid(mrWebUrl);
  const res = await gitlabFetch(
    `/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${iid}/pipelines`,
  );
  const pipelines = (await res.json()) as Array<{ status: PipelineStatus }>;
  return pipelines[0]?.status ?? "pending";
}

/**
 * Fetch the unified diff for a merge request (identified by web URL).
 */
export async function getMrDiff(mrWebUrl: string): Promise<string> {
  const iid = extractMrIid(mrWebUrl);
  const res = await gitlabFetch(
    `/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${iid}/diffs`,
  );
  const diffs = (await res.json()) as Array<{ diff: string; new_path: string }>;
  return diffs.map((d) => `--- ${d.new_path}\n${d.diff}`).join("\n\n");
}

/**
 * Post a review comment on a merge request.
 */
export async function postReviewComment(
  mrWebUrl: string,
  body: string,
): Promise<void> {
  const iid = extractMrIid(mrWebUrl);
  await gitlabFetch(
    `/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${iid}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

function extractMrIid(webUrl: string): string {
  const match = webUrl.match(/\/merge_requests\/(\d+)/);
  if (!match) throw new GitLabApiError(0, `Cannot extract MR IID from URL: ${webUrl}`);
  return match[1] as string;
}

export class GitLabApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "GitLabApiError";
  }
}
