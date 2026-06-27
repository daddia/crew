import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGitlabClient,
  extractMrIid,
  GitLabApiError,
  GitLabUrlError,
} from '../src/integrations/gitlab.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const client = createGitlabClient(
  { apiUrl: 'https://gitlab.test/api/v4', projectId: 'org/repo' },
  { gitlabAccessToken: 'test-token' },
);

const MR_URL = 'https://gitlab.test/org/repo/-/merge_requests/42';

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('approveMergeRequest and mergeMergeRequest', () => {
  beforeEach(() => fetchMock.mockReset());

  it('call the GitLab approve and merge REST endpoints and return merge commit SHA', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson({ approved_by: [{ user: { id: 1 } }] }))
      .mockResolvedValueOnce(mockJson({ merge_commit_sha: 'abc123def456' }));

    await client.approveMergeRequest(MR_URL);
    const sha = await client.mergeMergeRequest(MR_URL);

    expect(sha).toBe('abc123def456');
    expect(sha.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const approveCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(approveCall[0]).toContain('/merge_requests/42/approve');
    expect(approveCall[1].method).toBe('POST');

    const mergeCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mergeCall[0]).toContain('/merge_requests/42/merge');
    expect(mergeCall[1].method).toBe('PUT');
    expect(mergeCall[1].body).toBeUndefined();
  });

  it('propagates GitLabApiError from the approve endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    await expect(client.approveMergeRequest(MR_URL)).rejects.toThrow(GitLabApiError);
  });

  it('propagates GitLabApiError from the merge endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson({ approved_by: [] }))
      .mockResolvedValueOnce(new Response('Method Not Allowed', { status: 405 }));

    await client.approveMergeRequest(MR_URL);
    await expect(client.mergeMergeRequest(MR_URL)).rejects.toThrow(GitLabApiError);
  });
});

describe('extractMrIid', () => {
  it('returns the IID when the URL project path matches the expected project ID', () => {
    const iid = extractMrIid('daddia/crew', 'https://gitlab.com/daddia/crew/-/merge_requests/42');

    expect(iid).toBe('42');
  });

  it('throws GitLabUrlError when the URL project path does not match the expected project ID', () => {
    expect(() =>
      extractMrIid('daddia/crew', 'https://gitlab.com/other/repo/-/merge_requests/42'),
    ).toThrow(GitLabUrlError);

    expect(() =>
      extractMrIid('daddia/crew', 'https://gitlab.com/other/repo/-/merge_requests/42'),
    ).toThrow('expected "daddia/crew"');
  });

  it('throws GitLabUrlError when the URL contains no /merge_requests/{n} segment', () => {
    expect(() => extractMrIid('daddia/crew', 'https://gitlab.com/daddia/crew')).toThrow(
      GitLabUrlError,
    );
  });
});

describe('getMrDiff', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the full diff when within both caps', async () => {
    const diffs = [
      { new_path: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' },
      { new_path: 'src/b.ts', diff: '@@ -1 +1 @@\n-x\n+y' },
    ];
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const result = await client.getMrDiff(MR_URL);

    expect(result).toBe(
      '--- src/a.ts\n@@ -1 +1 @@\n-old\n+new\n\n--- src/b.ts\n@@ -1 +1 @@\n-x\n+y',
    );
    expect(result).not.toContain('omitted');
    expect(result).not.toContain('truncated');
  });

  it('truncates to diffFileCap files and appends an omission note', async () => {
    const diffs = Array.from({ length: 80 }, (_, i) => ({
      new_path: `src/file${i}.ts`,
      diff: `@@ -1 +1 @@\n-old${i}\n+new${i}`,
    }));
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const smallCapClient = createGitlabClient(
      { apiUrl: 'https://gitlab.test/api/v4', projectId: '99' },
      { gitlabAccessToken: 'test-token' },
      { diffFileCap: 50, diffSizeCapBytes: 10_000_000 },
    );
    const result = await smallCapClient.getMrDiff(MR_URL);

    const fileSections = (result.match(/^--- /gm) ?? []).length;
    expect(fileSections).toBe(50);
    expect(result).toContain('[30 files omitted — diff truncated at 50]');
  });

  it('truncates the diff string to diffSizeCapBytes and appends a byte note', async () => {
    const bigDiff = 'x'.repeat(1000);
    const diffs = [{ new_path: 'src/large.ts', diff: bigDiff }];
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const tinyCapClient = createGitlabClient(
      { apiUrl: 'https://gitlab.test/api/v4', projectId: '99' },
      { gitlabAccessToken: 'test-token' },
      { diffFileCap: 50, diffSizeCapBytes: 100 },
    );
    const result = await tinyCapClient.getMrDiff(MR_URL);

    expect(result).toContain('[diff truncated at 100 bytes]');
    const noteIndex = result.indexOf('\n[diff truncated');
    expect(noteIndex).toBe(100);
  });

  it('result length does not exceed diffSizeCapBytes plus the truncation suffix', async () => {
    const diffs = Array.from({ length: 80 }, (_, i) => ({
      new_path: `src/file${i}.ts`,
      diff: 'x'.repeat(500),
    }));
    fetchMock.mockResolvedValueOnce(mockJson(diffs));

    const cappedClient = createGitlabClient(
      { apiUrl: 'https://gitlab.test/api/v4', projectId: '99' },
      { gitlabAccessToken: 'test-token' },
      { diffFileCap: 50, diffSizeCapBytes: 200 },
    );
    const result = await cappedClient.getMrDiff(MR_URL);

    expect(result).toContain('[diff truncated at 200 bytes]');
    expect(result.length).toBeLessThanOrEqual(200 + '\n[diff truncated at 200 bytes]'.length);
  });

  it('throws GitLabApiError on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(client.getMrDiff(MR_URL)).rejects.toThrow(GitLabApiError);
  });
});

describe('getPipelineStatus', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the status of the most recent pipeline', async () => {
    fetchMock.mockResolvedValueOnce(mockJson([{ status: 'success' }, { status: 'failed' }]));

    const status = await client.getPipelineStatus(MR_URL);

    expect(status).toBe('success');
  });

  it("returns 'pending' when no pipelines exist yet", async () => {
    fetchMock.mockResolvedValueOnce(mockJson([]));

    const status = await client.getPipelineStatus(MR_URL);

    expect(status).toBe('pending');
  });
});

describe('findOpenMrForIssue', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the web_url of an open MR whose source branch contains the issue key', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson([
        { web_url: 'https://gitlab.test/org/repo/-/merge_requests/7', source_branch: 'main' },
        {
          web_url: 'https://gitlab.test/org/repo/-/merge_requests/8',
          source_branch: 'feature/CREW-66-005',
        },
      ]),
    );

    const url = await client.findOpenMrForIssue('CREW-66-005');

    expect(url).toBe('https://gitlab.test/org/repo/-/merge_requests/8');
  });

  it('returns null when no matching open MR exists', async () => {
    fetchMock.mockResolvedValueOnce(mockJson([]));

    const url = await client.findOpenMrForIssue('CREW-66-999');

    expect(url).toBeNull();
  });
});
