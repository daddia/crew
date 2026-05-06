import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitlabClient, GitLabApiError } from "../src/integrations/gitlab.js";
import type { CreateMrOptions } from "../src/integrations/gitlab.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const client = createGitlabClient(
  { apiUrl: "https://gitlab.test/api/v4", projectId: "my-project" },
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("source_branch=feature%2FCREW-66-004"),
      expect.any(Object),
    );
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
