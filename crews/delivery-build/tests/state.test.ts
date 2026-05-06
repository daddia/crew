import { afterEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createStateStore } from "../src/state.js";

let dbPath: string | undefined;

afterEach(() => {
  if (dbPath && existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
  dbPath = undefined;
});

function makePath(): string {
  const hex = randomBytes(8).toString("hex");
  dbPath = join(tmpdir(), `crew-state-test-${hex}.db`);
  return dbPath;
}

describe("createStateStore — single connection", () => {
  it("webhook_events table is created by the state store schema (no second connection needed)", () => {
    const store = createStateStore(makePath());
    // If the table were missing, this would throw a SQLite "no such table" error.
    expect(() => store.checkAndRecord("jira", "probe-evt")).not.toThrow();
    store.close();
  });
});

describe("StateStore.checkAndRecord", () => {
  it("returns false for a new (provider, eventId) pair", () => {
    const store = createStateStore(makePath());
    expect(store.checkAndRecord("jira", "evt-1")).toBe(false);
    store.close();
  });

  it("returns true when the same pair is presented again", () => {
    const store = createStateStore(makePath());
    store.checkAndRecord("jira", "evt-2");
    expect(store.checkAndRecord("jira", "evt-2")).toBe(true);
    store.close();
  });

  it("treats the same event id as distinct across providers", () => {
    const store = createStateStore(makePath());
    expect(store.checkAndRecord("jira", "shared-id")).toBe(false);
    expect(store.checkAndRecord("gitlab", "shared-id")).toBe(false);
    store.close();
  });

  it("returns true on a duplicate gitlab event", () => {
    const store = createStateStore(makePath());
    store.checkAndRecord("gitlab", "gl-evt-1");
    expect(store.checkAndRecord("gitlab", "gl-evt-1")).toBe(true);
    store.close();
  });
});

describe("StateStore.finishStep", () => {
  it("updates the correct row when two steps for the same issue are both unfinished", () => {
    const store = createStateStore(makePath());

    store.upsertStory("CREW-63", "implement");
    store.startStep("CREW-63", "implement");
    store.upsertStory("CREW-63", "peer-code-review");
    store.startStep("CREW-63", "peer-code-review");

    store.finishStep("CREW-63", "peer-code-review", { verdict: "approved" });

    const history = store.getStepHistory("CREW-63");
    const implementRow = history.find((r) => r.step === "implement");
    const reviewRow = history.find((r) => r.step === "peer-code-review");

    expect(reviewRow?.finishedAt).not.toBeNull();
    expect(implementRow?.finishedAt).toBeNull();

    store.close();
  });

  it("does not discard the step argument — WHERE clause binds step", () => {
    const store = createStateStore(makePath());

    store.upsertStory("CREW-63", "implement");
    store.startStep("CREW-63", "implement");

    // Finishing a step that was never started for this issue must not touch the implement row.
    store.finishStep("CREW-63", "peer-code-review", { verdict: "approved" });

    const history = store.getStepHistory("CREW-63");
    const implementRow = history.find((r) => r.step === "implement");
    expect(implementRow?.finishedAt).toBeNull();

    store.close();
  });
});

describe("StateStore.getInterruptedSteps", () => {
  it("returns an empty array when no steps have been started", () => {
    const store = createStateStore(makePath());
    expect(store.getInterruptedSteps()).toEqual([]);
    store.close();
  });

  it("returns steps with session_id set and finished_at null", () => {
    const store = createStateStore(makePath());
    store.upsertStory("CREW-63-001", "implement");
    store.startStep("CREW-63-001", "implement", "sess_abc");

    const rows = store.getInterruptedSteps();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issueKey).toBe("CREW-63-001");
    expect(rows[0]!.step).toBe("implement");
    expect(rows[0]!.sessionId).toBe("sess_abc");
    expect(rows[0]!.finishedAt).toBeNull();
    store.close();
  });

  it("does not return steps without a session_id", () => {
    const store = createStateStore(makePath());
    store.upsertStory("CREW-63-001", "context-seed");
    store.startStep("CREW-63-001", "context-seed"); // no sessionId

    expect(store.getInterruptedSteps()).toHaveLength(0);
    store.close();
  });

  it("does not return steps that have been finished", () => {
    const store = createStateStore(makePath());
    store.upsertStory("CREW-63-001", "implement");
    store.startStep("CREW-63-001", "implement", "sess_abc");
    store.finishStep("CREW-63-001", "implement", { verdict: "ok" });

    expect(store.getInterruptedSteps()).toHaveLength(0);
    store.close();
  });

  it("returns only the unfinished session row when one step is done and another is not", () => {
    const store = createStateStore(makePath());
    store.upsertStory("CREW-63-001", "implement");
    store.startStep("CREW-63-001", "implement", "sess_impl");
    store.finishStep("CREW-63-001", "implement", { verdict: "ok" });

    store.upsertStory("CREW-63-001", "address-feedback");
    store.startStep("CREW-63-001", "address-feedback", "sess_addr");

    const rows = store.getInterruptedSteps();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.step).toBe("address-feedback");
    expect(rows[0]!.sessionId).toBe("sess_addr");
    store.close();
  });
});
