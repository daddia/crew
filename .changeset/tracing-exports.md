---
"@daddia/crew": minor
---

Add OpenTelemetry tracing primitives to the main entry: `initTracing()` to bootstrap the Node SDK (with optional Honeycomb OTLP export), `createTracer()` to obtain a scoped Tracer, and the `TracingOptions` and `Tracer` types. Crews call `initTracing()` once at process start and `createTracer(name)` from their `observability.ts`.
