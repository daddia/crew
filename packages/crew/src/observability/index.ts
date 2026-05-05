export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  service: string;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function emit(
  service: string,
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const record: LogRecord = {
    level,
    service,
    msg,
    ts: new Date().toISOString(),
    ...fields,
  };
  process.stdout.write(JSON.stringify(record) + "\n");
}

/**
 * Create a structured JSON logger bound to a service name.
 * Every emitted record includes `service`, `level`, `msg`, and `ts`.
 * Additional fields are merged in from the optional `fields` argument.
 *
 * Usage:
 *   import { createLogger } from "@daddia/crew";
 *   const log = createLogger("delivery");
 *   log.info("server.start", { port: 3000 });
 */
export function createLogger(service: string): Logger {
  return {
    debug: (msg, fields) => emit(service, "debug", msg, fields),
    info: (msg, fields) => emit(service, "info", msg, fields),
    warn: (msg, fields) => emit(service, "warn", msg, fields),
    error: (msg, fields) => emit(service, "error", msg, fields),
  };
}
