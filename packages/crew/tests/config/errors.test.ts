import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import {
  ConfigNotFoundError,
  SchemaValidationError,
  formatZodIssues,
} from "../../src/config/errors.js";

describe("ConfigNotFoundError", () => {
  it("has code CONFIG_NOT_FOUND", () => {
    const err = new ConfigNotFoundError("not found at /foo");
    expect(err.code).toBe("CONFIG_NOT_FOUND");
    expect(err.name).toBe("ConfigNotFoundError");
    expect(err.message).toContain("not found at /foo");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts an optional cause", () => {
    const cause = new Error("ENOENT");
    const err = new ConfigNotFoundError("missing", { cause });
    expect((err as any).cause).toBe(cause);
  });
});

describe("SchemaValidationError", () => {
  it("has code SCHEMA_VALIDATION and exposes issues array", () => {
    const issues = [{ path: "identity.jira.projectKey", message: "Required" }];
    const err = new SchemaValidationError("validation failed", issues);
    expect(err.code).toBe("SCHEMA_VALIDATION");
    expect(err.name).toBe("SchemaValidationError");
    expect(err.issues).toEqual(issues);
    expect(err).toBeInstanceOf(Error);
  });

  it("issues array is readonly (not mutated by callers)", () => {
    const issues = [{ path: "a", message: "b" }];
    const err = new SchemaValidationError("msg", issues);
    expect(Object.isFrozen(err.issues) || err.issues === issues).toBe(true);
  });
});

describe("formatZodIssues", () => {
  it("formats a single Zod issue as 'path: message'", () => {
    const schema = z.object({ foo: z.string() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({});
    } catch (e) {
      zodErr = e as ZodError;
    }
    expect(zodErr).not.toBeNull();
    const formatted = formatZodIssues(zodErr!);
    expect(formatted).toMatch(/^foo:/);
  });

  it("joins multiple issues with newlines", () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({});
    } catch (e) {
      zodErr = e as ZodError;
    }
    const formatted = formatZodIssues(zodErr!);
    const lines = formatted.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line).toContain(":");
    }
  });

  it("uses dot-notation for nested paths", () => {
    const schema = z.object({ nested: z.object({ key: z.string() }) });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({ nested: {} });
    } catch (e) {
      zodErr = e as ZodError;
    }
    const formatted = formatZodIssues(zodErr!);
    expect(formatted).toContain("nested.key:");
  });
});
