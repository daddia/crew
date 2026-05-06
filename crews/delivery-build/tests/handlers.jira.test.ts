import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

vi.mock("../src/workflow.js", () => ({
  runStory: vi.fn().mockResolvedValue(undefined),
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

import { jiraHandler } from "../src/handlers/jira.js";
import { runStory } from "../src/workflow.js";
import type { StateStore } from "../src/state.js";

const SECRET = "test-secret";
process.env["JIRA_WEBHOOK_SECRET"] = SECRET;

function makeState(): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

function signBody(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeApp(state: StateStore): Hono {
  const app = new Hono();
  app.post("/webhooks/jira", (c) => jiraHandler(c, state));
  return app;
}

const validPayload = JSON.stringify({
  id: 42,
  timestamp: Date.now(),
  transition: { transitionName: "Ready for Dev" },
  issue: { key: "ENG-99" },
});

describe("POST /webhooks/jira", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when signature is missing", async () => {
    const app = makeApp(makeState());
    const res = await app.request("/webhooks/jira", {
      method: "POST",
      body: validPayload,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when signature is wrong", async () => {
    const app = makeApp(makeState());
    const res = await app.request("/webhooks/jira", {
      method: "POST",
      body: validPayload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
      },
    });
    expect(res.status).toBe(403);
  });

  it("dispatches runStory for Ready for Dev transition", async () => {
    const state = makeState();
    const app = makeApp(state);
    const res = await app.request("/webhooks/jira", {
      method: "POST",
      body: validPayload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signBody(validPayload),
      },
    });
    expect(res.status).toBe(200);
    // setImmediate is used — flush the microtask queue
    await new Promise((r) => setImmediate(r));
    expect(runStory).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "ENG-99" }),
    );
  });

  it("ignores non-Ready-for-Dev transitions", async () => {
    const body = JSON.stringify({
      id: 43,
      timestamp: Date.now(),
      transition: { transitionName: "In Progress" },
      issue: { key: "ENG-99" },
    });
    const app = makeApp(makeState());
    const res = await app.request("/webhooks/jira", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signBody(body),
      },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json["ignored"]).toBe(true);
  });
});
