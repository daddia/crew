import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../src/workflow.js", () => ({
  addressFeedback: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@daddia/crew/webhooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@daddia/crew/webhooks")>();
  return {
    ...actual,
    createIdempotencyStore: vi.fn().mockReturnValue({
      checkAndRecord: vi.fn().mockReturnValue(false),
      close: vi.fn(),
    }),
  };
});

import { gitlabHandler } from "../src/handlers/gitlab.js";
import { addressFeedback } from "../src/workflow.js";
import type { StateStore } from "../src/state.js";

const SECRET = "gl-test-secret";
process.env["GITLAB_WEBHOOK_SECRET"] = SECRET;

function makeState(): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

function makeApp(state: StateStore): Hono {
  const app = new Hono();
  app.post("/webhooks/gitlab", (c) => gitlabHandler(c, state));
  return app;
}

const notePayload = JSON.stringify({
  object_kind: "note",
  object_attributes: { id: 1, note: "Please fix the null check", system: false },
  merge_request: {
    title: "[ENG-99] Add login endpoint",
    url: "https://gitlab.example.com/mr/1",
  },
});

describe("POST /webhooks/gitlab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when token is missing", async () => {
    const app = makeApp(makeState());
    const res = await app.request("/webhooks/gitlab", {
      method: "POST",
      body: notePayload,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when token is wrong", async () => {
    const app = makeApp(makeState());
    const res = await app.request("/webhooks/gitlab", {
      method: "POST",
      body: notePayload,
      headers: {
        "Content-Type": "application/json",
        "x-gitlab-token": "wrong",
      },
    });
    expect(res.status).toBe(403);
  });

  it("dispatches addressFeedback for a human MR comment", async () => {
    const state = makeState();
    const app = makeApp(state);
    const res = await app.request("/webhooks/gitlab", {
      method: "POST",
      body: notePayload,
      headers: {
        "Content-Type": "application/json",
        "x-gitlab-token": SECRET,
        "x-gitlab-event-uuid": "evt-001",
      },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(addressFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "ENG-99" }),
      "Please fix the null check",
      "https://gitlab.example.com/mr/1",
    );
  });

  it("ignores system-generated notes", async () => {
    const systemPayload = JSON.stringify({
      object_kind: "note",
      object_attributes: { id: 2, note: "approved this merge request", system: true },
      merge_request: {
        title: "[ENG-99] Add login endpoint",
        url: "https://gitlab.example.com/mr/1",
      },
    });
    const state = makeState();
    const app = makeApp(state);
    await app.request("/webhooks/gitlab", {
      method: "POST",
      body: systemPayload,
      headers: {
        "Content-Type": "application/json",
        "x-gitlab-token": SECRET,
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(addressFeedback).not.toHaveBeenCalled();
  });
});
