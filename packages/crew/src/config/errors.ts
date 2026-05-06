import type { ZodError } from "zod";

export class ConfigNotFoundError extends Error {
  readonly code = "CONFIG_NOT_FOUND" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigNotFoundError";
  }
}

export class SchemaValidationError extends Error {
  readonly code = "SCHEMA_VALIDATION" as const;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    message: string,
    issues: ReadonlyArray<{ path: string; message: string }>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Convert a ZodError to a human-readable multi-line string suitable for
 * structured error logs and on-call dashboards.
 *
 * Each line has the form "path.to.field: message", matching the format
 * that downstream tooling should treat as stable.
 */
export function formatZodIssues(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n");
}
