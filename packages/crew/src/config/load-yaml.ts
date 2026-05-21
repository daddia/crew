import { readFile } from 'node:fs/promises';
import { ZodError, type ZodSchema } from 'zod';
import { parse as parseYaml } from 'yaml';
import { ConfigNotFoundError, SchemaValidationError, formatZodIssues } from './errors.js';

/**
 * Read a YAML file from disk, parse it, and validate the result against a
 * Zod schema. Returns the typed, validated object on success.
 *
 * Throws:
 * - ConfigNotFoundError when the file does not exist or cannot be read.
 * - SchemaValidationError when the file contains invalid YAML syntax or the
 *   parsed document fails Zod validation. The issues array and message follow
 *   the same stable format as loadEnv().
 */
export async function loadYaml<T>(
  filePath: string,
  schema: ZodSchema<T>,
  label: string,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    throw new ConfigNotFoundError(`${label} not found at ${filePath}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: unknown) {
    throw new SchemaValidationError(
      `${label} at ${filePath} contains invalid YAML`,
      [{ path: '', message: 'invalid YAML syntax' }],
      { cause: err },
    );
  }

  try {
    return schema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new SchemaValidationError(
        `${label} at ${filePath} failed schema validation:\n${formatZodIssues(err)}`,
        issues,
        { cause: err },
      );
    }
    throw err;
  }
}
