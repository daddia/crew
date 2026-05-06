import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace } from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";

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

export interface TracingOptions {
  /** The OTel service.name used to identify this crew in Honeycomb. */
  serviceName: string;
  /**
   * Honeycomb ingest API key. When provided the OTLP exporter is pointed at
   * https://api.honeycomb.io with the x-honeycomb-team header set. When
   * absent the SDK falls back to standard OTel env vars (OTEL_TRACES_EXPORTER,
   * OTEL_EXPORTER_OTLP_ENDPOINT, etc.) or discards spans if none are set.
   */
  honeycombApiKey?: string;
}

/**
 * Bootstrap the OpenTelemetry Node SDK. Must be called once at process start,
 * before the HTTP server or poller bind. Registers the global tracer provider
 * so subsequent createTracer() calls return live spans.
 *
 * When honeycombApiKey is provided, traces are exported to Honeycomb via OTLP
 * HTTP. When absent, the SDK auto-detects exporters from OTel env vars, or
 * runs in no-op mode if no exporter is configured — safe to call unconditionally.
 */
export function initTracing(options: TracingOptions): void {
  const traceExporter = options.honeycombApiKey
    ? new OTLPTraceExporter({
        url: "https://api.honeycomb.io/v1/traces",
        headers: { "x-honeycomb-team": options.honeycombApiKey },
      })
    : undefined;

  const sdk = new NodeSDK({
    serviceName: options.serviceName,
    ...(traceExporter !== undefined && { traceExporter }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}

/**
 * Return an OTel Tracer bound to the given instrumentation scope name.
 * Call initTracing() before using any tracer; until then the global provider
 * is a no-op and spans are silently discarded.
 *
 * Usage:
 *   import { createTracer } from "@daddia/crew";
 *   const tracer = createTracer("delivery-build");
 *   tracer.startActiveSpan("workflow.step", (span) => { ... span.end(); });
 */
export function createTracer(name: string): Tracer {
  return trace.getTracer(name);
}

export type { Tracer };
