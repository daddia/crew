import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Finding, MrContext, ReviewResult } from "../src/types.js";

// Mock global fetch before importing poster.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { postRefusal, postReview } from "../src/poster.js";

const baseMrCtx: MrContext = {
  projectId: "42",
  mrIid: "7",
  mrUrl: "https://gitlab.example.com/project/-/merge_requests/7",
  diff: "",
  fileCount: 3,
  baseSha: "aaa",
  startSha: "bbb",
  headSha: "ccc",
  targetBranch: "main",
};

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "high",
    file: "src/foo.ts",
    line: 10,
    title: "Missing error handling",
    body: "The function does not handle the error case.",
    confidence: "high",
    ...overrides,
  };
}

function makeReview(findings: Finding[], overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings,
    summary: "Reviewed 3 files. Found 1 issue.",
    filesReviewed: ["src/foo.ts"],
    costUsd: 0.08,
    durationMs: 30_000,
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ id: 1 }), { status: 201 });
}

describe("postReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(okResponse());
  });

  it("posts one inline thread per finding", async () => {
    const review = makeReview([makeFinding(), makeFinding({ file: "src/bar.ts", line: 20 })]);

    await postReview(baseMrCtx, review);

    const discussionCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/discussions"),
    );
    expect(discussionCalls).toHaveLength(2);
  });

  it("posts a summary comment after inline threads", async () => {
    const review = makeReview([makeFinding()]);

    await postReview(baseMrCtx, review);

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(1);

    const [, init] = noteCalls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { body: string };
    expect(body.body).toContain("AI Code Review");
    expect(body.body).toContain("Reviewed 3 files");
  });

  it("falls back to MR note when inline thread returns 4xx", async () => {
    const errorResponse = new Response("Unprocessable", { status: 422 });
    const successResponse = okResponse();

    // First call (discussions) fails; second call (fallback notes) succeeds; third (summary) succeeds.
    mockFetch
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValue(successResponse);

    const review = makeReview([makeFinding()]);
    await postReview(baseMrCtx, review);

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    // Fallback note + summary note.
    expect(noteCalls).toHaveLength(2);
  });

  it("includes severity badge and confidence in inline thread body", async () => {
    const review = makeReview([makeFinding({ severity: "critical", confidence: "high" })]);

    await postReview(baseMrCtx, review);

    const [[, init]] = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/discussions"),
    ) as [[string, RequestInit]];
    const body = JSON.parse(init.body as string) as { body: string };
    expect(body.body).toContain("[CRITICAL]");
    expect(body.body).toContain("Confidence: high");
  });

  it("sends the correct SHA position data in inline threads", async () => {
    const review = makeReview([makeFinding()]);

    await postReview(baseMrCtx, review);

    const [[, init]] = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/discussions"),
    ) as [[string, RequestInit]];
    const payload = JSON.parse(init.body as string) as {
      position: { base_sha: string; head_sha: string; new_path: string; new_line: number };
    };

    expect(payload.position.base_sha).toBe("aaa");
    expect(payload.position.head_sha).toBe("ccc");
    expect(payload.position.new_path).toBe("src/foo.ts");
    expect(payload.position.new_line).toBe(10);
  });

  it("posts no inline threads and only a summary when findings list is empty", async () => {
    const review = makeReview([]);

    await postReview(baseMrCtx, review);

    const discussionCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/discussions"),
    );
    expect(discussionCalls).toHaveLength(0);

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(1);
  });
});

describe("postRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(okResponse());
  });

  it("posts a single note explaining the MR is too large", async () => {
    await postRefusal(baseMrCtx, 75, 50);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { body: string };
    expect(body.body).toContain("75 files");
    expect(body.body).toContain("AI review was skipped");
  });
});

describe("gitlabPost retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(new Response("err", { status: 503 })))
      .mockImplementation(() => Promise.resolve(okResponse()));

    const review = makeReview([]);
    const promise = postReview(baseMrCtx, review);

    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(2);
  });

  it("retries up to twice on 5xx then throws GitLabPosterError", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response("err", { status: 502 })));

    const review = makeReview([]);
    const promise = postReview(baseMrCtx, review);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "GitLabPosterError",
      statusCode: 502,
    });

    await vi.advanceTimersByTimeAsync(1_000 + 3_000);
    await assertion;

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(3);
  });

  it("does not retry on 4xx — falls back to MR note immediately", async () => {
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(new Response("nope", { status: 422 })))
      .mockImplementation(() => Promise.resolve(okResponse()));

    const review = makeReview([makeFinding()]);
    await postReview(baseMrCtx, review);

    const discussionCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/discussions"),
    );
    expect(discussionCalls).toHaveLength(1);
  });

  it("retries when fetch itself rejects (network error)", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("ECONNRESET"))
      .mockImplementation(() => Promise.resolve(okResponse()));

    const review = makeReview([]);
    const promise = postReview(baseMrCtx, review);

    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(2);
  });

  it("throws GitLabPosterError when network errors exhaust all attempts", async () => {
    const networkErr = new TypeError("ECONNRESET");
    mockFetch.mockRejectedValue(networkErr);

    const review = makeReview([]);
    const promise = postReview(baseMrCtx, review);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "GitLabPosterError",
      statusCode: 0,
      cause: networkErr,
    });

    await vi.advanceTimersByTimeAsync(1_000 + 3_000);
    await assertion;

    const noteCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes("/notes"),
    );
    expect(noteCalls).toHaveLength(3);
  });
});
