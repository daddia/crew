import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { loadMrContext, GitLabContextError } from "../src/context.js";

const mrInfoPayload = {
  web_url: "https://gitlab.example.com/project/-/merge_requests/7",
  target_branch: "main",
  diff_refs: { base_sha: "aaa", start_sha: "bbb", head_sha: "ccc" },
};

const diffsPayload = [
  { diff: "@@ -1 +1 @@\n-old\n+new", new_path: "src/foo.ts", old_path: "src/foo.ts" },
  { diff: "@@ -0,0 +1 @@\n+added", new_path: "src/bar.ts", old_path: "/dev/null" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loadMrContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["CI_PROJECT_ID"] = "42";
    process.env["CI_MERGE_REQUEST_IID"] = "7";
  });

  it("returns MR context from parallel API calls", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mrInfoPayload));
    mockFetch.mockResolvedValueOnce(jsonResponse(diffsPayload));

    const ctx = await loadMrContext();

    expect(ctx.projectId).toBe("42");
    expect(ctx.mrIid).toBe("7");
    expect(ctx.mrUrl).toBe(mrInfoPayload.web_url);
    expect(ctx.targetBranch).toBe("main");
    expect(ctx.baseSha).toBe("aaa");
    expect(ctx.startSha).toBe("bbb");
    expect(ctx.headSha).toBe("ccc");
    expect(ctx.fileCount).toBe(2);
  });

  it("formats the diff with --- and +++ headers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mrInfoPayload));
    mockFetch.mockResolvedValueOnce(jsonResponse(diffsPayload));

    const ctx = await loadMrContext();

    expect(ctx.diff).toContain("--- src/foo.ts");
    expect(ctx.diff).toContain("+++ src/foo.ts");
    expect(ctx.diff).toContain("--- /dev/null");
    expect(ctx.diff).toContain("+++ src/bar.ts");
  });

  it("URL-encodes project ID with slashes (group/subgroup/project)", async () => {
    process.env["CI_PROJECT_ID"] = "group/project";
    mockFetch.mockResolvedValueOnce(jsonResponse(mrInfoPayload));
    mockFetch.mockResolvedValueOnce(jsonResponse(diffsPayload));

    await loadMrContext();

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/projects/group%2Fproject/");
  });

  it("throws GitLabContextError with status code on non-ok response", async () => {
    // Use mockImplementation so each parallel fetch gets a fresh Response —
    // a Response body can only be consumed once.
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ message: "Not Found" }, 404)));

    await expect(loadMrContext()).rejects.toThrow(GitLabContextError);

    try {
      await loadMrContext();
    } catch (err) {
      expect(err).toBeInstanceOf(GitLabContextError);
      expect((err as GitLabContextError).statusCode).toBe(404);
    }
  });

  it("throws when CI_PROJECT_ID is not set", async () => {
    delete process.env["CI_PROJECT_ID"];
    await expect(loadMrContext()).rejects.toThrow("CI_PROJECT_ID");
  });

  it("throws when CI_MERGE_REQUEST_IID is not set", async () => {
    delete process.env["CI_MERGE_REQUEST_IID"];
    await expect(loadMrContext()).rejects.toThrow("CI_MERGE_REQUEST_IID");
  });
});
