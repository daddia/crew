import type { Context } from "hono";
import { CONFIG_SCHEMA_VERSION } from "../config.js";
import { inFlight } from "../in-flight.js";
import { lastTickAt, lastTickStatus } from "../poller-state.js";
import type { StateStore } from "../state.js";

export interface HealthzBody {
  ok: boolean;
  schemaVersion: number;
  poller: {
    lastTickAt: number | null;
    lastTickStatus: "ok" | "error" | null;
    inFlightCount: number;
    inFlight: string[];
  };
  db: {
    ok: boolean;
    path: string;
  };
}

/**
 * Returns a structured health payload. Always responds HTTP 200 so Railway's
 * healthcheck does not bounce the container on transient DB errors — operators
 * should read the body, not the status code, to detect degraded state.
 */
export function healthzHandler(c: Context, state: StateStore, dbPath: string): Response {
  let dbOk = false;
  try {
    state.ping();
    dbOk = true;
  } catch {
    // DB is degraded; surface via db.ok: false rather than throwing.
  }

  const body: HealthzBody = {
    ok: true,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    poller: {
      lastTickAt,
      lastTickStatus,
      inFlightCount: inFlight.size,
      inFlight: [...inFlight],
    },
    db: {
      ok: dbOk,
      path: dbPath,
    },
  };

  return c.json(body);
}
