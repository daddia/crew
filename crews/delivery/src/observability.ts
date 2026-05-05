/**
 * Structured JSON logging to stdout.
 * OTel spans are deferred until a second crew requires them.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const record: LogRecord = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...fields,
  };
  process.stdout.write(JSON.stringify(record) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),
};
