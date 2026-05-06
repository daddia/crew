import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["GITLAB_API_URL"] = "https://gitlab.test/api/v4";
process.env["GITLAB_PERSONAL_ACCESS_TOKEN"] = "test-token";
process.env["GITLAB_PROJECT_ID"] = "my-project";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { getPipelineStatus, GitLabApiError } from "../src/integrations/gitlab.js";

const MR_URL = "https://gitlab.test/org/repo/-/merge_requests/42";

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getPipelineStatus", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns the status of the most recent pipeline", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([{ status: "success" }, { status: "failed" }]),
    );

    const status = await getPipelineStatus(MR_URL);

    expect(status).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/merge_requests/42/pipelines"),
      expect.any(Object),
    );
  });

  it("returns 'pending' when no pipelines exist yet", async () => {
    fetchMock.mockResolvedValueOnce(mockJson([]));

    const status = await getPipelineStatus(MR_URL);

    expect(status).toBe("pending");
  });

  it("returns 'failed' when the latest pipeline failed", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([{ status: "failed" }, { status: "success" }]),
    );

    const status = await getPipelineStatus(MR_URL);

    expect(status).toBe("failed");
  });

  it("throws GitLabApiError on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(getPipelineStatus(MR_URL)).rejects.toThrow(GitLabApiError);
  });
});
