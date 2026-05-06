import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadYaml } from "../../src/config/load-yaml.js";
import {
  ConfigNotFoundError,
  SchemaValidationError,
} from "../../src/config/errors.js";

const schema = z.object({
  project: z.object({
    name: z.string().min(1),
    key: z.string().min(1),
  }),
});

const TMP = join(tmpdir(), `crew-load-yaml-tests-${process.pid}`);

async function writeFixture(name: string, content: string): Promise<string> {
  await mkdir(TMP, { recursive: true });
  const path = join(TMP, name);
  await writeFile(path, content, "utf-8");
  return path;
}

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("loadYaml – happy path", () => {
  it("parses a valid YAML file and returns the typed result", async () => {
    const path = await writeFixture(
      "valid.yaml",
      "project:\n  name: Test\n  key: TEST\n",
    );
    const result = await loadYaml(path, schema, "test config");
    expect(result.project.name).toBe("Test");
    expect(result.project.key).toBe("TEST");
  });
});

describe("loadYaml – file not found", () => {
  it("throws ConfigNotFoundError when the file does not exist", async () => {
    await expect(
      loadYaml("/nonexistent/path/to/config.yaml", schema, "test config"),
    ).rejects.toThrow(ConfigNotFoundError);
  });

  it("ConfigNotFoundError message includes the file path", async () => {
    const path = "/some/missing/file.yaml";
    let err: ConfigNotFoundError | null = null;
    try {
      await loadYaml(path, schema, "test label");
    } catch (e) {
      err = e as ConfigNotFoundError;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain(path);
    expect(err!.code).toBe("CONFIG_NOT_FOUND");
  });
});

describe("loadYaml – invalid YAML", () => {
  it("throws SchemaValidationError whose message mentions invalid YAML", async () => {
    const path = await writeFixture(
      "bad.yaml",
      "  :\n  - invalid: [unclosed\n",
    );
    let err: SchemaValidationError | null = null;
    try {
      await loadYaml(path, schema, "test config");
    } catch (e) {
      err = e as SchemaValidationError;
    }
    expect(err).not.toBeNull();
    expect(err!.message.toLowerCase()).toContain("invalid yaml");
    expect(err!.code).toBe("SCHEMA_VALIDATION");
  });
});

describe("loadYaml – schema validation failure", () => {
  it("throws SchemaValidationError when YAML is valid but schema fails", async () => {
    const path = await writeFixture(
      "incomplete.yaml",
      "project:\n  name: Missing Key\n",
    );
    let err: SchemaValidationError | null = null;
    try {
      await loadYaml(path, schema, "test config");
    } catch (e) {
      err = e as SchemaValidationError;
    }
    expect(err).not.toBeNull();
    expect(err!.code).toBe("SCHEMA_VALIDATION");
    expect(err!.issues.some((i) => i.path.includes("key"))).toBe(true);
  });

  it("includes the file path in the error message", async () => {
    const path = await writeFixture(
      "bad-schema.yaml",
      "project:\n  name: OnlyName\n",
    );
    let err: SchemaValidationError | null = null;
    try {
      await loadYaml(path, schema, "my config");
    } catch (e) {
      err = e as SchemaValidationError;
    }
    expect(err!.message).toContain(path);
  });
});
