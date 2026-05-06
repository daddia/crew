import { describe, it, expect, vi, beforeEach } from "vitest";

const BASE_URL = "https://test.atlassian.net";
process.env["ATLASSIAN_BASE_URL"] = BASE_URL;
process.env["ATLASSIAN_EMAIL"] = "bot@example.com";
process.env["ATLASSIAN_API_TOKEN"] = "token";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { transitionIssue, commentOnIssue, getIssue, JiraApiError } from "../src/integrations/jira.js";

function mockTransitionsResponse(
  transitions: Array<{ id: string; name: string; to: { name: string } }>,
): Response {
  return new Response(JSON.stringify({ transitions }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockOk(): Response {
  return new Response(null, { status: 204 });
}

describe("transitionIssue", () => {
  beforeEach(() => fetchMock.mockReset());

  it("applies the matching transition by name", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockTransitionsResponse([
          { id: "11", name: "Ready for Dev", to: { name: "Ready for Dev" } },
          { id: "21", name: "In Progress", to: { name: "In Progress" } },
        ]),
      )
      .mockResolvedValueOnce(mockOk());

    await transitionIssue("ENG-1", "In Progress");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, postCall] = fetchMock.mock.calls as [unknown[], unknown[]][];
    const postBody = JSON.parse((postCall?.[1] as { body: string })?.body ?? "{}") as {
      transition: { id: string };
    };
    expect(postBody.transition.id).toBe("21");
  });

  it("does nothing when the transition is not available", async () => {
    fetchMock.mockResolvedValueOnce(
      mockTransitionsResponse([
        { id: "11", name: "Ready for Dev", to: { name: "Ready for Dev" } },
      ]),
    );

    await transitionIssue("ENG-1", "Done");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getIssue", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns summary and description extracted from an ADF document", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fields: {
            summary: "Build the feature",
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Do this work." }],
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const issue = await getIssue("ENG-1");

    expect(issue.summary).toBe("Build the feature");
    expect(issue.description).toBe("Do this work.");
    expect(issue.acceptanceCriteria).toBeNull();
  });

  it("returns null description when the ADF field is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ fields: { summary: "My Story", description: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const issue = await getIssue("ENG-1");
    expect(issue.description).toBeNull();
  });

  it("concatenates text from nested ADF nodes with newlines", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fields: {
            summary: "Multi-paragraph",
            description: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Line one." }] },
                { type: "paragraph", content: [{ type: "text", text: "Line two." }] },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const issue = await getIssue("ENG-1");
    expect(issue.description).toBe("Line one.\nLine two.");
  });

  it("throws JiraApiError when the API returns a non-2xx status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(getIssue("ENG-999")).rejects.toThrow(JiraApiError);
  });
});

describe("commentOnIssue", () => {
  beforeEach(() => fetchMock.mockReset());

  it("posts a comment with the correct ADF structure", async () => {
    fetchMock.mockResolvedValueOnce(mockOk());

    await commentOnIssue("ENG-1", "hello world");

    const [call] = fetchMock.mock.calls as [unknown[], unknown[]][];
    const body = JSON.parse((call?.[1] as { body: string })?.body ?? "{}") as {
      body: { content: Array<{ content: Array<{ text: string }> }> };
    };
    expect(body.body.content[0]?.content[0]?.text).toBe("hello world");
  });
});
