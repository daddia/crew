import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGitlabClient,
  extractMrIid,
  GitLabApiError,
  GitLabUrlError,
} from "../src/integrations/gitlab.js";
import type { CreateMrOptions } from "../src/integrations/gitlab.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const client = createGitlabClient(
  { apiUrl: "https://gitlab.test/api/v4", projectId: "org/repo" },
  { gitlabAccessToken: "test-token" },
);

const MR_URL = "https://gitlab.test/org/repo/-/merge_requests/42";

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MR_OPTIONS: CreateMrOptions = {
  issueKey: "CREW-66-004",
  branchName: "feature/CREW-66-004",
  title: "feat: idempotency guard",
};

describe("createMr", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns the existing MR web_url without issuing a POST when an open MR exists", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([{ web_url: "https://gitlab.test/org/repo/-/merge_requests/7" }]),
    );

    const url = await client.createMr(MR_OPTIONS);

    expect(url).toBe("https://gitlab.test/org/repo/-/merge_requests/7");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lookupUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(lookupUrl).toContain("source_branch=feature%2FCREW-66-004");
    expect(lookupUrl).toContain("state=opened");
  });

  it("issues a POST and returns the new MR web_url when no open MR exists", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson([]))
      .mockResolvedValueOnce(
        mockJson({ web_url: "https://gitlab.test/org/repo/-/merge_requests/8" }),
      );

    const url = await client.createMr(MR_OPTIONS);

    expect(url).toBe("https://gitlab.test/org/repo/-/merge_requests/8");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const postCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postCall[1].method).toBe("POST");
  });

  it("propagates a GitLabApiError from the GET lookup without issuing a POST", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    await expect(client.createMr(MR_OPTIONS)).rejects.toThrow(GitLabApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getMrDiff", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns the full diff when within both caps", async () => {
    const diffs = [
      { new_path: "src/a.ts", diff: "@@ -1 +1 @@\n-old\n+new" },
      { new_path: "src/b.ts", diff: "@@ -1 +1 @@\n-x\n+y" },
    ];
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const result = await client.getMrDiff(MR_URL);

    expect(result).toBe(
      "--- src/a.ts\n@@ -1 +1 @@\n-old\n+new\n\n--- src/b.ts\n@@ -1 +1 @@\n-x\n+y",
    );
    expect(result).not.toContain("omitted");
    expect(result).not.toContain("truncated");
  });

  it("truncates to DIFF_FILE_CAP files and appends an omission note", async () => {
    const diffs = Array.from({ length: 80 }, (_, i) => ({
      new_path: `src/file${i}.ts`,
      diff: `@@ -1 +1 @@\n-old${i}\n+new${i}`,
    }));
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    // Numeric project ID bypasses the URL-path validation in extractMrIid.
    const smallCapClient = createGitlabClient(
      { apiUrl: "https://gitlab.test/api/v4", projectId: "99" },
      { gitlabAccessToken: "test-token" },
      { diffFileCap: 50, diffSizeCapBytes: 10_000_000 },
    );
    const result = await smallCapClient.getMrDiff(MR_URL);

    const fileSections = (result.match(/^--- /gm) ?? []).length;
    expect(fileSections).toBe(50);
    expect(result).toContain("[30 files omitted — diff truncated at 50]");
  });

  it("truncates the diff string to DIFF_SIZE_CAP_BYTES and appends a byte note", async () => {
    const bigDiff = "x".repeat(1000);
    const diffs = [{ new_path: "src/large.ts", diff: bigDiff }];
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const tinyCapClient = createGitlabClient(
      { apiUrl: "https://gitlab.test/api/v4", projectId: "99" },
      { gitlabAccessToken: "test-token" },
      { diffFileCap: 50, diffSizeCapBytes: 100 },
    );
    const result = await tinyCapClient.getMrDiff(MR_URL);

    expect(result).toContain("[diff truncated at 100 bytes]");
    const noteIndex = result.indexOf("\n[diff truncated");
    expect(noteIndex).toBe(100);
  });

  it("applies file cap before byte cap when both are exceeded", async () => {
    // 10 files; file cap = 3 removes files 3–9; the remaining ~240-char string
    // is then cut to 50 chars by the byte cap.
    const diffs = Array.from({ length: 10 }, (_, i) => ({
      new_path: `src/f${i}.ts`,
      diff: "x".repeat(100),
    }));
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const bothCapClient = createGitlabClient(
      { apiUrl: "https://gitlab.test/api/v4", projectId: "99" },
      { gitlabAccessToken: "test-token" },
      { diffFileCap: 3, diffSizeCapBytes: 50 },
    );
    const result = await bothCapClient.getMrDiff(MR_URL);

    // Byte cap applied: note at position 50
    expect(result).toContain("[diff truncated at 50 bytes]");
    expect(result.indexOf("\n[diff truncated at 50 bytes]")).toBe(50);
    // File cap applied first: content starts with f0, and f9 was never included
    expect(result.startsWith("--- src/f0.ts\n")).toBe(true);
    expect(result).not.toContain("src/f9.ts");
  });

  it("uses default caps of 50 files and 500000 bytes when behaviour is omitted", async () => {
    const defaultClient = createGitlabClient(
      { apiUrl: "https://gitlab.test/api/v4", projectId: "99" },
      { gitlabAccessToken: "test-token" },
    );
    const diffs = Array.from({ length: 10 }, (_, i) => ({
      new_path: `src/f${i}.ts`,
      diff: "small",
    }));
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const result = await defaultClient.getMrDiff(MR_URL);

    expect(result).not.toContain("omitted");
    expect(result).not.toContain("truncated");
  });

  it("throws GitLabApiError on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(client.getMrDiff(MR_URL)).rejects.toThrow(GitLabApiError);
  });
});

describe("getPipelineStatus", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns the status of the most recent pipeline", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([{ status: "success" }, { status: "failed" }]),
    );

    const status = await client.getPipelineStatus(MR_URL);

    expect(status).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/merge_requests/42/pipelines"),
      expect.any(Object),
    );
  });

  it("returns 'pending' when no pipelines exist yet", async () => {
    fetchMock.mockResolvedValueOnce(mockJson([]));

    const status = await client.getPipelineStatus(MR_URL);

    expect(status).toBe("pending");
  });

  it("returns 'failed' when the latest pipeline failed", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([{ status: "failed" }, { status: "success" }]),
    );

    const status = await client.getPipelineStatus(MR_URL);

    expect(status).toBe("failed");
  });

  it("throws GitLabApiError on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(client.getPipelineStatus(MR_URL)).rejects.toThrow(GitLabApiError);
  });
});

describe("extractMrIid", () => {
  it("returns the IID when the URL project path matches the expected project ID", () => {
    const iid = extractMrIid("daddia/crew", "https://gitlab.com/daddia/crew/-/merge_requests/42");

    expect(iid).toBe("42");
  });

  it("throws GitLabUrlError when the URL project path does not match the expected project ID", () => {
    expect(() =>
      extractMrIid("daddia/crew", "https://gitlab.com/other/repo/-/merge_requests/42"),
    ).toThrow(GitLabUrlError);

    expect(() =>
      extractMrIid("daddia/crew", "https://gitlab.com/other/repo/-/merge_requests/42"),
    ).toThrow('expected "daddia/crew"');

    expect(() =>
      extractMrIid("daddia/crew", "https://gitlab.com/other/repo/-/merge_requests/42"),
    ).toThrow('received "other/repo"');
  });

  it("throws GitLabUrlError when the URL contains no /merge_requests/{n} segment", () => {
    expect(() => extractMrIid("daddia/crew", "https://gitlab.com/daddia/crew")).toThrow(
      GitLabUrlError,
    );
  });
});
