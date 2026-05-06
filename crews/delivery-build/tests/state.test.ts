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
