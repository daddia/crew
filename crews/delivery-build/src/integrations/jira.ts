/**
 * Deterministic Jira API calls used by the workflow orchestrator.
 *
 * These are NOT model calls. They are direct REST calls to the Jira API with
 * structured errors and explicit retry behaviour. Agents use MCP for Jira
 * access; this module is for the workflow's own idempotent state transitions.
 */

import { log } from '../observability.js';

export interface JiraClient {
  /** Returns `true` when the transition was applied, `false` when unavailable. */
  transitionIssue(issueKey: string, targetStatusName: string): Promise<boolean>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  commentOnIssue(issueKey: string, body: string): Promise<void>;
  getComments(issueKey: string): Promise<JiraComment[]>;
  searchIssues(jql: string): Promise<Array<{ issueKey: string }>>;
}

export interface JiraIssue {
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
  /** Parent issue key (Epic or Story parent), if present on the ticket. */
  parentKey?: string;
}

export interface JiraComment {
  accountId: string;
  author: string;
  body: string;
  created: string;
}

/** Non-deprecated Jira Cloud JQL search path (replaces `/search` and `/issue/search`). */
export const JIRA_JQL_SEARCH_PATH = '/search/jql';

const SEARCH_PAGE_SIZE = 50;

/** Initial attempt plus this many retries on transient 5xx / network errors. */
const FETCH_MAX_RETRIES = 3;
const FETCH_BASE_BACKOFF_MS = 250;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function backoffDelayMs(attempt: number): number {
  return FETCH_BASE_BACKOFF_MS * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JiraApiError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'JiraApiError';
  }
}

/**
 * Create a Jira API client bound to the given identity and credentials.
 * All requests use the base URL and auth token supplied at construction time.
 */
export function createJiraClient(
  identity: { baseUrl: string; email: string; acceptanceCriteriaFieldId: string },
  secrets: { atlassianApiToken: string },
): JiraClient {
  const { baseUrl, email, acceptanceCriteriaFieldId } = identity;
  const authHeader =
    'Basic ' + Buffer.from(`${email}:${secrets.atlassianApiToken}`).toString('base64');

  async function jiraFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${baseUrl}/rest/api/3${path}`;
    const method = init?.method ?? 'GET';
    let lastError: JiraApiError | undefined;

    for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          ...init,
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(init?.headers as Record<string, string> | undefined),
          },
        });

        if (res.ok) {
          return res;
        }

        const text = await res.text().catch(() => '');
        const error = new JiraApiError(res.status, `${method} ${path}: ${text}`);

        if (isRetryableStatus(res.status) && attempt < FETCH_MAX_RETRIES) {
          lastError = error;
          await sleep(backoffDelayMs(attempt));
          continue;
        }

        throw error;
      } catch (err) {
        if (err instanceof JiraApiError) {
          throw err;
        }

        if (attempt < FETCH_MAX_RETRIES) {
          lastError = new JiraApiError(
            0,
            `${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
          );
          await sleep(backoffDelayMs(attempt));
          continue;
        }

        throw lastError ?? err;
      }
    }

    throw lastError ?? new JiraApiError(0, `${method} ${path}: request failed after retries`);
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
      if (!transition) {
        log.warn('jira.transition.missing', { issueKey, targetStatus: targetStatusName });
        return false;
      }
      await jiraFetch(`/issue/${issueKey}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
      return true;
    },

    async getIssue(issueKey) {
      const fields = `summary,description,parent,${acceptanceCriteriaFieldId}`;
      const res = await jiraFetch(`/issue/${issueKey}?fields=${encodeURIComponent(fields)}`);
      const data = (await res.json()) as {
        fields: Record<string, unknown> & {
          summary: string;
          description: unknown;
          parent?: { key: string };
        };
      };
      return {
        summary: data.fields.summary,
        description: extractAdfText(data.fields.description),
        acceptanceCriteria: extractAdfText(data.fields[acceptanceCriteriaFieldId]),
        parentKey: data.fields.parent?.key,
      };
    },

    async commentOnIssue(issueKey, body) {
      await jiraFetch(`/issue/${issueKey}/comment`, {
        method: 'POST',
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
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
        accountId: c.author.accountId ?? '',
        author: c.author.emailAddress ?? c.author.displayName ?? '',
        body: extractAdfText(c.body) ?? '',
        created: c.created,
      }));
    },

    async searchIssues(jql) {
      const results: Array<{ issueKey: string }> = [];
      let nextPageToken: string | undefined;

      do {
        const body: {
          jql: string;
          maxResults: number;
          fields: string[];
          nextPageToken?: string;
        } = {
          jql,
          maxResults: SEARCH_PAGE_SIZE,
          fields: ['key'],
        };
        if (nextPageToken !== undefined) {
          body.nextPageToken = nextPageToken;
        }

        const res = await jiraFetch(JIRA_JQL_SEARCH_PATH, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as {
          issues?: Array<{ key: string }>;
          nextPageToken?: string;
        };

        for (const issue of data.issues ?? []) {
          results.push({ issueKey: issue.key });
        }
        nextPageToken = data.nextPageToken;
      } while (nextPageToken);

      return results;
    },
  };
}

function extractAdfText(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map(extractAdfText).filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  return null;
}
