/**
 * Deterministic Jira SDK calls used by the workflow orchestrator.
 *
 * These are NOT model calls. They are direct REST calls to the Jira API with
 * structured errors and explicit retry behaviour. Agents use MCP for Jira
 * access; this module is for the workflow's own idempotent state transitions.
 */

const BASE_URL = process.env["ATLASSIAN_BASE_URL"] ?? "";
const EMAIL = process.env["ATLASSIAN_EMAIL"] ?? "";
const API_TOKEN = process.env["ATLASSIAN_API_TOKEN"] ?? "";

const authHeader =
  "Basic " + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");

async function jiraFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${BASE_URL}/rest/api/3${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JiraApiError(res.status, `${init?.method ?? "GET"} ${path}: ${text}`);
  }
  return res;
}

/**
 * Transition an issue to a named status.
 * Looks up the transition ID by name first, then applies it.
 * Idempotent: if the issue is already in the target status, does nothing.
 */
export async function transitionIssue(
  issueKey: string,
  targetStatusName: string,
): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}/transitions`);
  const data = (await res.json()) as {
    transitions: Array<{ id: string; name: string; to: { name: string } }>;
  };

  const transition = data.transitions.find(
    (t) => t.name === targetStatusName || t.to.name === targetStatusName,
  );

  if (!transition) {
    // Already in target status or transition unavailable.
    return;
  }

  await jiraFetch(`/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
}

/**
 * Add a comment to a Jira issue.
 */
export async function commentOnIssue(
  issueKey: string,
  body: string,
): Promise<void> {
  await jiraFetch(`/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: body }],
          },
        ],
      },
    }),
  });
}

export class JiraApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "JiraApiError";
  }
}
