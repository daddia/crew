import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/cli.js";

describe("loadConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["DIFF_FILE_CAP", "MAX_FINDINGS", "SEVERITY_THRESHOLD"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("returns defaults when env vars are not set", () => {
    const cfg = loadConfig();
    expect(cfg.diffFileCap).toBe(50);
    expect(cfg.maxFindings).toBe(10);
    expect(cfg.severityThreshold).toBe("high");
  });

  it("reads valid numeric env vars", () => {
    process.env["DIFF_FILE_CAP"] = "25";
    process.env["MAX_FINDINGS"] = "5";
    const cfg = loadConfig();
    expect(cfg.diffFileCap).toBe(25);
    expect(cfg.maxFindings).toBe(5);
  });

  it("reads valid severity env var", () => {
    process.env["SEVERITY_THRESHOLD"] = "medium";
    expect(loadConfig().severityThreshold).toBe("medium");
  });

  it("normalises severity to lower case", () => {
    process.env["SEVERITY_THRESHOLD"] = "HIGH";
    expect(loadConfig().severityThreshold).toBe("high");
  });

  it("defaults diffFileCap to 50 when value is NaN", () => {
    process.env["DIFF_FILE_CAP"] = "notanumber";
    expect(loadConfig().diffFileCap).toBe(50);
  });

  it("defaults maxFindings to 10 when value is zero or negative", () => {
    process.env["MAX_FINDINGS"] = "0";
    expect(loadConfig().maxFindings).toBe(10);

    process.env["MAX_FINDINGS"] = "-3";
    expect(loadConfig().maxFindings).toBe(10);
  });

  it("defaults severityThreshold to high for an unrecognised value", () => {
    process.env["SEVERITY_THRESHOLD"] = "catastrophic";
    expect(loadConfig().severityThreshold).toBe("high");
  });

  it("accepts all valid severity values", () => {
    for (const sev of ["critical", "high", "medium", "low", "note"] as const) {
      process.env["SEVERITY_THRESHOLD"] = sev;
      expect(loadConfig().severityThreshold).toBe(sev);
    }
  });
});
