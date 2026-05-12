/**
 * CREW-67-003 — Health endpoint exposes poller state and in-flight count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../src/poller-state.js", () => ({
  lastTickAt: null,
  lastTickStatus: null,
}));

vi.mock("../src/in-flight.js", () => ({
  inFlight: new Set<string>(),
  acquire: vi.fn(),
  release: vi.fn(),
  has: vi.fn().mockReturnValue(false),
  runStoryWithLock: vi.fn(),
}));

import { healthzHandler } from "../src/handlers/healthz.js";
import * as pollerState from "../src/poller-state.js";
import * as inFlightModule from "../src/in-flight.js";
import { CONFIG_SCHEMA_VERSION } from "../src/config.js";
import type { StateStore } from "../src/state.js";

function makeState(pingImpl?: () => void): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: pingImpl ?? vi.fn(),
    close: vi.fn(),
  };
}

function makeApp(state: StateStore, dbPath = "/data/crew.db"): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => healthzHandler(c, state, dbPath));
  return app;
}

// Helper to read the response body as JSON
async function getHealthz(app: Hono): Promise<Record<string, unknown>> {
  const res = await app.request("/healthz");
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Fixtures ─────────────────────────────────────────────────────────────

function setPollerState(tickAt: number | null, tickStatus: "ok" | "error" | null): void {
  // Cast to mutable to update vi.mock'd module values between tests.
  (pollerState as { lastTickAt: number | null; lastTickStatus: "ok" | "error" | null }).lastTickAt = tickAt;
  (pollerState as { lastTickAt: number | null; lastTickStatus: "ok" | "error" | null }).lastTickStatus = tickStatus;
}

function setInFlight(...issueKeys: string[]): void {
  const set = (inFlightModule as { inFlight: Set<string> }).inFlight;
  set.clear();
  for (const k of issueKeys) set.add(k);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("/healthz — response envelope", () => {
  beforeEach(() => {
    setPollerState(null, null);
    setInFlight();
  });

  it("returns HTTP 200", async () => {
    const app = makeApp(makeState());
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("response body contains ok: true", async () => {
    const body = await getHealthz(makeApp(makeState()));
    expect(body["ok"]).toBe(true);
  });

  it("response body contains schemaVersion matching CONFIG_SCHEMA_VERSION", async () => {
    const body = await getHealthz(makeApp(makeState()));
    expect(body["schemaVersion"]).toBe(CONFIG_SCHEMA_VERSION);
  });

  it("response body contains poller and db sections", async () => {
    const body = await getHealthz(makeApp(makeState()));
    expect(body["poller"]).toBeDefined();
    expect(body["db"]).toBeDefined();
  });
});

describe("/healthz — poller section", () => {
  beforeEach(() => {
    setPollerState(null, null);
    setInFlight();
  });

  it("lastTickAt is null before the first tick", async () => {
    setPollerState(null, null);
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["lastTickAt"]).toBeNull();
  });

  it("lastTickAt is a ms epoch after a tick fires", async () => {
    const ts = Date.now();
    setPollerState(ts, "ok");
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["lastTickAt"]).toBe(ts);
  });

  it("lastTickStatus reflects the tick outcome", async () => {
    setPollerState(Date.now(), "ok");
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["lastTickStatus"]).toBe("ok");
  });

  it("lastTickStatus is 'error' when the last tick failed", async () => {
    setPollerState(Date.now(), "error");
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["lastTickStatus"]).toBe("error");
  });

  it("inFlightCount is 0 when no workflows are running", async () => {
    setInFlight();
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["inFlightCount"]).toBe(0);
    expect(poller["inFlight"]).toEqual([]);
  });

  it("inFlightCount and inFlight reflect the shared in-flight set", async () => {
    setInFlight("CREW-67-003", "CREW-67-004");
    const body = await getHealthz(makeApp(makeState()));
    const poller = body["poller"] as Record<string, unknown>;
    expect(poller["inFlightCount"]).toBe(2);
    expect(poller["inFlight"]).toEqual(expect.arrayContaining(["CREW-67-003", "CREW-67-004"]));
  });
});

describe("/healthz — db section", () => {
  beforeEach(() => {
    setPollerState(null, null);
    setInFlight();
  });

  it("db.ok is true when ping() does not throw", async () => {
    const state = makeState(() => { /* no-op, healthy */ });
    const body = await getHealthz(makeApp(state, "/data/crew.db"));
    const db = body["db"] as Record<string, unknown>;
    expect(db["ok"]).toBe(true);
  });

  it("db.path matches the value passed at construction", async () => {
    const body = await getHealthz(makeApp(makeState(), "/volumes/crew.db"));
    const db = body["db"] as Record<string, unknown>;
    expect(db["path"]).toBe("/volumes/crew.db");
  });

  it("db.ok is false when ping() throws", async () => {
    const state = makeState(() => { throw new Error("SQLITE_BUSY"); });
    const body = await getHealthz(makeApp(state));
    const db = body["db"] as Record<string, unknown>;
    expect(db["ok"]).toBe(false);
  });

  it("returns HTTP 200 even when db.ok is false", async () => {
    const state = makeState(() => { throw new Error("disk full"); });
    const app = makeApp(state);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});
