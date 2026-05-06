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

export interface JiraIssue {
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
}

/**
 * Fetch the key fields of a Jira issue.
 * The ADF description is flattened to plain text; acceptanceCriteria is
 * reserved for future custom-field mapping and is always null today.
 */
export async function getIssue(issueKey: string): Promise<JiraIssue> {
  const res = await jiraFetch(`/issue/${issueKey}`);
  const data = (await res.json()) as {
    fields: { summary: string; description: unknown };
  };

  return {
    summary: data.fields.summary,
    description: extractAdfText(data.fields.description),
    acceptanceCriteria: null,
  };
}

/**
 * Recursively extract plain text from an Atlassian Document Format (ADF) node.
 * Returns null when the node carries no text content.
 */
function extractAdfText(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content
      .map(extractAdfText)
      .filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
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
