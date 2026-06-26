import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/observability.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createJiraClient, JiraApiError } from '../src/integrations/jira.js';
import { log } from '../src/observability.js';

const BASE_URL = 'https://test.atlassian.net';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const client = createJiraClient(
  { baseUrl: BASE_URL, email: 'bot@example.com' },
  { atlassianApiToken: 'token' },
);

function mockTransitionsResponse(
  transitions: Array<{ id: string; name: string; to: { name: string } }>,
): Response {
  return new Response(JSON.stringify({ transitions }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockOk(): Response {
  return new Response(null, { status: 204 });
}

describe('transitionIssue', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(log.warn).mockReset();
  });

  it('applies the matching transition by name', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockTransitionsResponse([
          { id: '11', name: 'Ready for Dev', to: { name: 'Ready for Dev' } },
          { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
        ]),
      )
      .mockResolvedValueOnce(mockOk());

    const transitioned = await client.transitionIssue('ENG-1', 'In Progress');

    expect(transitioned).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, postCall] = fetchMock.mock.calls as [unknown[], unknown[]][];
    const postBody = JSON.parse((postCall?.[1] as { body: string })?.body ?? '{}') as {
      transition: { id: string };
    };
    expect(postBody.transition.id).toBe('21');
  });

  it('logs a warning and returns false when the transition is not available', async () => {
    fetchMock.mockResolvedValueOnce(
      mockTransitionsResponse([{ id: '11', name: 'Ready for Dev', to: { name: 'Ready for Dev' } }]),
    );

    const transitioned = await client.transitionIssue('ENG-1', 'Done');

    expect(transitioned).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('jira.transition.missing', {
      issueKey: 'ENG-1',
      targetStatus: 'Done',
    });
  });
});

describe('getIssue', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns summary and description extracted from an ADF document', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fields: {
            summary: 'Build the feature',
            description: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do this work.' }] }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const issue = await client.getIssue('ENG-1');

    expect(issue.summary).toBe('Build the feature');
    expect(issue.description).toBe('Do this work.');
    expect(issue.acceptanceCriteria).toBeNull();
  });

  it('returns null description when the ADF field is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ fields: { summary: 'My Story', description: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const issue = await client.getIssue('ENG-1');
    expect(issue.description).toBeNull();
  });

  it('concatenates text from nested ADF nodes with newlines', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fields: {
            summary: 'Multi-paragraph',
            description: {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Line one.' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Line two.' }] },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const issue = await client.getIssue('ENG-1');
    expect(issue.description).toBe('Line one.\nLine two.');
  });

  it('throws JiraApiError when the API returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(client.getIssue('ENG-999')).rejects.toThrow(JiraApiError);
  });
});

describe('searchIssues', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns an array of issueKey objects from the search response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [{ key: 'CREW-1' }, { key: 'CREW-2' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await client.searchIssues('project = "CREW" AND status = "To Do"');

    expect(results).toEqual([{ issueKey: 'CREW-1' }, { issueKey: 'CREW-2' }]);
  });

  it('uses POST /search/jql with JQL and fields in the request body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const jql = 'project = "CREW" AND status = "To Do"';
    await client.searchIssues(jql);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.pathname).toContain('/search/jql');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as {
      jql: string;
      fields: string[];
      maxResults: number;
    };
    expect(body.jql).toBe(jql);
    expect(body.fields).toEqual(['key']);
    expect(body.maxResults).toBe(50);
  });

  it('retrieves all pages via nextPageToken', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issues: [{ key: 'CREW-1' }],
            nextPageToken: 'page-2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issues: [{ key: 'CREW-2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const results = await client.searchIssues('project = "CREW"');

    expect(results).toEqual([{ issueKey: 'CREW-1' }, { issueKey: 'CREW-2' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      nextPageToken: string;
    };
    expect(secondBody.nextPageToken).toBe('page-2');
  });

  it('returns an empty array when no issues match', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await client.searchIssues('project = "CREW" AND status = "To Do"');
    expect(results).toEqual([]);
  });

  it('throws JiraApiError when the API returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

    await expect(client.searchIssues('project = "CREW" AND status = "To Do"')).rejects.toThrow(
      JiraApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('jiraFetch retries', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient 503 errors with backoff before succeeding', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issues: [{ key: 'CREW-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const promise = client.searchIssues('project = "CREW"');
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toEqual([{ issueKey: 'CREW-1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable 4xx errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(client.getIssue('ENG-999')).rejects.toThrow(JiraApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('commentOnIssue', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts a comment with the correct ADF structure', async () => {
    fetchMock.mockResolvedValueOnce(mockOk());

    await client.commentOnIssue('ENG-1', 'hello world');

    const [call] = fetchMock.mock.calls as [unknown[], unknown[]][];
    const body = JSON.parse((call?.[1] as { body: string })?.body ?? '{}') as {
      body: { content: Array<{ content: Array<{ text: string }> }> };
    };
    expect(body.body.content[0]?.content[0]?.text).toBe('hello world');
  });
});

describe('getComments', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns author email, plain-text body, and created for each comment', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          comments: [
            {
              author: { accountId: 'acc-001', emailAddress: 'pm@example.com', displayName: 'PM' },
              body: {
                type: 'doc',
                version: 1,
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Here is the answer.' }] },
                ],
              },
              created: '2026-01-01T12:00:00.000+0000',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const comments = await client.getComments('ENG-1');

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      accountId: 'acc-001',
      author: 'pm@example.com',
      body: 'Here is the answer.',
      created: '2026-01-01T12:00:00.000+0000',
    });
  });

  it('falls back to displayName when emailAddress is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          comments: [
            {
              author: { accountId: 'acc-ext', displayName: 'External User' },
              body: null,
              created: '2026-01-01T12:00:00.000+0000',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const comments = await client.getComments('ENG-1');

    expect(comments[0]?.accountId).toBe('acc-ext');
    expect(comments[0]?.author).toBe('External User');
    expect(comments[0]?.body).toBe('');
  });

  it('returns an empty array when there are no comments', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ comments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const comments = await client.getComments('ENG-1');
    expect(comments).toEqual([]);
  });

  it('calls the correct Jira API endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ comments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.getComments('ENG-42');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/issue/ENG-42/comment');
  });

  it('throws JiraApiError when the API returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(client.getComments('ENG-999')).rejects.toThrow(JiraApiError);
  });
});

describe('createJiraClient — uses the supplied base URL', () => {
  it('targets the provided base URL, not any environment variable', async () => {
    fetchMock.mockReset();
    const customClient = createJiraClient(
      { baseUrl: 'https://custom.atlassian.net', email: 'user@example.com' },
      { atlassianApiToken: 'custom-token' },
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ issues: [] }), { status: 200 }));

    await customClient.searchIssues('project = X');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('custom.atlassian.net');
    expect(url).not.toContain('test.atlassian.net');
  });
});
