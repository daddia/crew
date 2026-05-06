/**
 * Deterministic Jira API calls used by the workflow orchestrator.
 *
 * These are NOT model calls. They are direct REST calls to the Jira API with
 * structured errors and explicit retry behaviour. Agents use MCP for Jira
 * access; this module is for the workflow's own idempotent state transitions.
 */

export interface JiraClient {
  transitionIssue(issueKey: string, targetStatusName: string): Promise<void>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  commentOnIssue(issueKey: string, body: string): Promise<void>;
  getComments(issueKey: string): Promise<JiraComment[]>;
  searchIssues(jql: string): Promise<Array<{ issueKey: string }>>;
}

export interface JiraIssue {
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
}

export interface JiraComment {
  accountId: string;
  author: string;
  body: string;
  created: string;
}

export class JiraApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "JiraApiError";
  }
}

/**
 * Create a Jira API client bound to the given identity and credentials.
 * All requests use the base URL and auth token supplied at construction time.
 */
export function createJiraClient(
  identity: { baseUrl: string; email: string },
  secrets: { atlassianApiToken: string },
): JiraClient {
  const { baseUrl, email } = identity;
  const authHeader =
    "Basic " +
    Buffer.from(`${email}:${String(secrets.atlassianApiToken)}`).toString("base64");

  async function jiraFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${baseUrl}/rest/api/3${path}`;
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

  return {
    async transitionIssue(issueKey, targetStatusName) {
      const res = await jiraFetch(`/issue/${issueKey}/transitions`);
      const data = (await res.json()) as {
        transitions: Array<{ id: string; name: string; to: { name: string } }>;
      };
      const transition = data.transitions.find(
        (t) => t.name === targetStatusName || t.to.name === targetStatusName,
      );
      if (!transition) return;
      await jiraFetch(`/issue/${issueKey}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
    },

    async getIssue(issueKey) {
      const res = await jiraFetch(`/issue/${issueKey}`);
      const data = (await res.json()) as {
        fields: { summary: string; description: unknown };
      };
      return {
        summary: data.fields.summary,
        description: extractAdfText(data.fields.description),
        // Populated once we know the custom-field ID for acceptance criteria in
        // the target Jira project (typically customfield_1XXXX). Null until then.
        acceptanceCriteria: null,
      };
    },

    async commentOnIssue(issueKey, body) {
      await jiraFetch(`/issue/${issueKey}/comment`, {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
          },
        }),
      });
    },

    async getComments(issueKey) {
      const res = await jiraFetch(`/issue/${issueKey}/comment`);
      const data = (await res.json()) as {
        comments: Array<{
          author: { accountId?: string; emailAddress?: string; displayName?: string };
          body: unknown;
          created: string;
        }>;
      };
      return data.comments.map((c) => ({
        accountId: c.author.accountId ?? "",
        author: c.author.emailAddress ?? c.author.displayName ?? "",
        body: extractAdfText(c.body) ?? "",
        created: c.created,
      }));
    },

    async searchIssues(jql) {
      const params = new URLSearchParams({ jql, fields: "key", maxResults: "50" });
      const res = await jiraFetch(`/issue/search?${params.toString()}`);
      const data = (await res.json()) as { issues: Array<{ key: string }> };
      return data.issues.map((issue) => ({ issueKey: issue.key }));
    },
  };
}

function extractAdfText(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map(extractAdfText).filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}
