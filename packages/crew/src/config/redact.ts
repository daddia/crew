import type { ZodTypeAny } from "zod";

/**
 * Unique symbol used as the TypeScript brand for Secret-marked schema fields.
 * Callers use the `Secret()` function to apply the brand; they do not need to
 * reference this symbol directly.
 */
export const SECRET_BRAND: unique symbol = Symbol("crew.config.secret");

/**
 * TypeScript brand type for a secret-marked Zod schema node.
 * The underlying Zod schema is unchanged at runtime; the brand is a
 * compile-time marker only.
 */
export type Secret<T extends ZodTypeAny> = T & { _secretBrand: typeof SECRET_BRAND };

/**
 * A WeakSet of schema nodes that have been registered as secrets via Secret().
 * Because Zod v4 brand() returns the same schema instance, this registry
 * uses the schema object's identity for O(1) lookup during schema walking.
 */
const secretSchemaSet = new WeakSet<object>();

/**
 * Mark a Zod schema field as containing a secret value. At the TypeScript
 * level this adds a brand to the schema's inferred type, signalling to
 * callers that the value must not appear in logs. At runtime it registers
 * the schema node so redact() can locate it when walking a parsed config.
 */
export function Secret<T extends ZodTypeAny>(inner: T): Secret<T> {
  secretSchemaSet.add(inner);
  return inner as Secret<T>;
}

/**
 * Stores the set of dot-path strings that are secret for each parsed config
 * object. Populated by attachSecretPaths() (called from loadEnv/loadYaml)
 * and consumed by redact().
 */
const secretPathsRegistry = new WeakMap<object, ReadonlySet<string>>();

/**
 * Walk a Zod schema tree and collect every dot-path whose leaf schema node
 * is registered in secretSchemaSet.
 *
 * Handles ZodObject (via .shape), ZodOptional/ZodDefault/other wrappers
 * (via _def.innerType), and plain leaf nodes.
 */
function findSecretPaths(schema: ZodTypeAny, prefix: string): string[] {
  if (secretSchemaSet.has(schema)) {
    return prefix ? [prefix] : [];
  }

  // ZodObject: recurse into each field with its key appended to the prefix
  const shape = (schema as unknown as Record<string, unknown>).shape;
  if (shape && typeof shape === "object" && shape !== null) {
    const paths: string[] = [];
    for (const [key, fieldSchema] of Object.entries(
      shape as Record<string, ZodTypeAny>,
    )) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      paths.push(...findSecretPaths(fieldSchema, childPrefix));
    }
    return paths;
  }

  // Wrapper types (ZodOptional, ZodDefault, ZodNullable …) expose their
  // inner schema via _def.innerType in Zod v4.
  const innerType = (schema as unknown as { _def?: { innerType?: ZodTypeAny } })
    ._def?.innerType;
  if (innerType) {
    return findSecretPaths(innerType, prefix);
  }

  return [];
}

/**
 * Record which dot-paths in a parsed config object are secret.
 * Called by loadEnv and loadYaml immediately after schema.parse() succeeds
 * so that redact() can later locate and replace those paths.
 */
export function attachSecretPaths(result: object, schema: ZodTypeAny): void {
  const paths = findSecretPaths(schema, "");
  if (paths.length > 0) {
    secretPathsRegistry.set(result, new Set(paths));
  }
}

/**
 * Return a deep clone of value with every Secret-marked field replaced by
 * the string "***". The original value is not mutated.
 *
 * Works only on objects that were produced by loadEnv() or loadYaml(); for
 * other objects it returns a structural clone with no secrets replaced.
 */
export function redact<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const clone = structuredClone(value) as Record<string, unknown>;

  const paths = secretPathsRegistry.get(value as object);
  if (paths) {
    for (const path of paths) {
      const keys = path.split(".");
      let cursor = clone;
      for (let i = 0; i < keys.length - 1; i++) {
        const next = cursor[keys[i]!];
        if (next === null || typeof next !== "object") break;
        cursor = next as Record<string, unknown>;
      }
      cursor[keys[keys.length - 1]!] = "***";
    }
    // Carry the secret-path registry forward so the clone is also redactable.
    secretPathsRegistry.set(clone as object, paths);
  }

  return clone as T;
}
