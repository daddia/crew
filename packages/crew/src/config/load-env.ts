import { ZodError, type ZodSchema } from "zod";
import { SchemaValidationError, formatZodIssues } from "./errors.js";
import { attachSecretPaths } from "./redact.js";
import type { ZodTypeAny } from "zod";

/**
 * Maps a schema field's dot-notation path to the env var that supplies its
 * value. Every entry is a pair:
 *   "nested.field.name" -> "ENV_VAR_NAME"
 *
 * Missing env vars are left as undefined, which Zod treats as absent. Fields
 * without a mapping entry receive no value from the environment and will fail
 * validation if required.
 */
export type EnvMapping = Record<string, string>;

/**
 * Convert a flat dot-notation env-var map into the nested object that the
 * Zod schema expects. Only paths present in the mapping are set; undefined
 * env values are omitted so Zod can apply defaults or surface "Required".
 */
function buildNestedFromEnv(
  env: NodeJS.ProcessEnv,
  mapping: EnvMapping,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [dotPath, envVar] of Object.entries(mapping)) {
    const raw = env[envVar];
    const keys = dotPath.split(".");

    // Always materialise intermediate objects so Zod can apply field-level
    // defaults even when no env var is set for that subtree.
    let cursor = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (typeof cursor[key] !== "object" || cursor[key] === null) {
        cursor[key] = {};
      }
      cursor = cursor[key] as Record<string, unknown>;
    }

    // Only write the leaf when the env var is actually present.
    if (raw !== undefined) {
      cursor[keys[keys.length - 1]!] = raw;
    }
  }

  return result;
}

/**
 * Read env vars according to the mapping, build a nested object, validate it
 * against the Zod schema, and return the typed result.
 *
 * Throws SchemaValidationError if any field fails validation. The issues
 * array in the error contains one entry per failed field with a stable
 * "path.to.field: message" format.
 *
 * Secret-marked fields in the schema are tracked on the result so that
 * redact() can replace them without requiring access to the schema.
 */
export function loadEnv<T>(
  env: NodeJS.ProcessEnv,
  schema: ZodSchema<T>,
  mapping: EnvMapping,
): T {
  const nested = buildNestedFromEnv(env, mapping);

  let result: T;
  try {
    result = schema.parse(nested);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new SchemaValidationError(
        `Config validation failed:\n${formatZodIssues(err)}`,
        issues,
      );
    }
    throw err;
  }

  if (result !== null && typeof result === "object") {
    attachSecretPaths(result as object, schema as unknown as ZodTypeAny);
  }

  return result;
}
