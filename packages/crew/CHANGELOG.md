# @daddia/crew

## 0.3.0

### Minor Changes

- f7a6c23: Add @daddia/crew/config subpath export with loadEnv, loadYaml, Secret/redact primitives, detectWorkspace, ConfigNotFoundError, and SchemaValidationError. Adds zod ^4 and yaml as runtime dependencies.
- 03b044b: Add OpenTelemetry tracing primitives to the main entry: `initTracing()` to bootstrap the Node SDK (with optional Honeycomb OTLP export), `createTracer()` to obtain a scoped Tracer, and the `TracingOptions` and `Tracer` types. Crews call `initTracing()` once at process start and `createTracer(name)` from their `observability.ts`.
