import type { MrContext } from "./types.js";

const API_URL = process.env["GITLAB_API_URL"] ?? "https://gitlab.com/api/v4";
const TOKEN = process.env["GITLAB_TOKEN"] ?? "";

interface GitLabMrInfo {
  web_url: string;
  target_branch: string;
  diff_refs: {
    base_sha: string;
    start_sha: string;
    head_sha: string;
  };
}

interface GitLabDiffEntry {
  diff: string;
  new_path: string;
  old_path: string;
}

async function gitlabFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "PRIVATE-TOKEN": TOKEN },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GitLabContextError(res.status, `GET ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set`);
  return value;
}

function formatDiff(diffs: GitLabDiffEntry[]): string {
  return diffs
    .map((d) => `--- ${d.old_path}\n+++ ${d.new_path}\n${d.diff}`)
    .join("\n\n");
}

export async function loadMrContext(): Promise<MrContext> {
  const projectId = requireEnv("CI_PROJECT_ID");
  const mrIid = requireEnv("CI_MERGE_REQUEST_IID");

  const encoded = encodeURIComponent(projectId);

  const [mrInfo, diffs] = await Promise.all([
    gitlabFetch<GitLabMrInfo>(`/projects/${encoded}/merge_requests/${mrIid}`),
    gitlabFetch<GitLabDiffEntry[]>(`/projects/${encoded}/merge_requests/${mrIid}/diffs`),
  ]);

  return {
    projectId,
    mrIid,
    mrUrl: mrInfo.web_url,
    fileCount: diffs.length,
    diff: formatDiff(diffs),
    baseSha: mrInfo.diff_refs.base_sha,
    startSha: mrInfo.diff_refs.start_sha,
    headSha: mrInfo.diff_refs.head_sha,
    targetBranch: mrInfo.target_branch,
  };
}

export class GitLabContextError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "GitLabContextError";
  }
}
