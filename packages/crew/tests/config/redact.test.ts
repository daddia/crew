import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Secret, redact } from "../../src/config/redact.js";
import { loadEnv } from "../../src/config/load-env.js";

const schema = z.object({
  identity: z.object({
    projectKey: z.string(),
  }),
  secrets: z.object({
    apiKey: Secret(z.string().min(1)),
    token: Secret(z.string().min(1)),
  }),
});

const mapping = {
  "identity.projectKey": "PROJECT_KEY",
  "secrets.apiKey": "API_KEY",
  "secrets.token": "TOKEN",
};

function makeConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadEnv(
    {
      PROJECT_KEY: "PROJ",
      API_KEY: "super-secret-key",
      TOKEN: "another-secret",
      ...overrides,
    },
    schema,
    mapping,
  );
}

describe("redact", () => {
  it("replaces Secret-branded values with '***'", () => {
    const config = makeConfig();
    const result = redact(config);
    expect(result.secrets.apiKey).toBe("***");
    expect(result.secrets.token).toBe("***");
  });

  it("preserves non-secret fields", () => {
    const config = makeConfig();
    const result = redact(config);
    expect(result.identity.projectKey).toBe("PROJ");
  });

  it("does not mutate the original config", () => {
    const config = makeConfig();
    redact(config);
    expect(config.secrets.apiKey).toBe("super-secret-key");
    expect(config.secrets.token).toBe("another-secret");
  });

  it("handles secrets nested at depth > 1", () => {
    const deepSchema = z.object({
      a: z.object({
        b: z.object({
          secret: Secret(z.string()),
          plain: z.string(),
        }),
      }),
    });
    const deepMapping = {
      "a.b.secret": "DEEP_SECRET",
      "a.b.plain": "DEEP_PLAIN",
    };
    const config = loadEnv(
      { DEEP_SECRET: "hidden-value", DEEP_PLAIN: "visible" },
      deepSchema,
      deepMapping,
    );
    const result = redact(config);
    expect(result.a.b.secret).toBe("***");
    expect(result.a.b.plain).toBe("visible");
  });

  it("returns the value unchanged when no secrets are registered", () => {
    const plainValue = { foo: "bar" };
    const result = redact(plainValue);
    expect(result.foo).toBe("bar");
  });

  it("is idempotent: redacting an already-redacted object replaces '***' again", () => {
    const config = makeConfig();
    const first = redact(config);
    const second = redact(first);
    expect(second.secrets.apiKey).toBe("***");
    expect(second.identity.projectKey).toBe("PROJ");
  });

  it("handles secrets inside optional-wrapped schema fields", () => {
    const optSchema = z.object({
      sec: Secret(z.string().min(1)).optional(),
      plain: z.string(),
    });
    const optMapping = { sec: "OPT_SECRET", plain: "OPT_PLAIN" };
    const config = loadEnv(
      { OPT_SECRET: "mysecret", OPT_PLAIN: "visible" },
      optSchema,
      optMapping,
    );
    const result = redact(config);
    expect(result.sec).toBe("***");
    expect(result.plain).toBe("visible");
  });
});
