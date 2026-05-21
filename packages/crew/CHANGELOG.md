# @daddia/crew

## 0.4.0

### Minor Changes

- Add `@daddia/crew/state` subpath export: `StateStore` interface, `StoryRow`, `StepRow`, `StepResult` types, and `createSqliteStateStore(dbPath)` — a SQLite implementation with WAL mode, prepared statements, and the standard three-table schema (`stories`, `steps`, `webhook_events`). Server-shaped crews should use this instead of rolling their own SQLite layer.
- Add `@daddia/crew/workflow` subpath export: `WorkflowPlan`, `WorkflowStep`, `FailurePolicy`, `WorkflowEngine`, `WorkflowEngineOptions`, and `createWorkflowEngine(options)`. The engine writes crash-recovery markers, accumulates step artefacts into a shared context, handles per-step retries, and calls an `onEscalate` callback on unrecoverable failure.
- Add `Orchestrator`, `OrchestratorRequest`, and `AgentRegistry` types to the main entry. An `Orchestrator` takes a request and an agent registry and returns a `WorkflowPlan` — enabling deterministic or Claude-assisted dynamic workflow assembly.
- Add `orchestrator?: Orchestrator` optional field to the `AgentCrew` interface.
- Add `toSDKHookCallback()`, `ToolUseEvent`, and `PostToolUseHandler` to the main entry for lower-level hook integration.

## 0.3.0

### Minor Changes

- f7a6c23: Add @daddia/crew/config subpath export with loadEnv, loadYaml, Secret/redact primitives, detectWorkspace, ConfigNotFoundError, and SchemaValidationError. Adds zod ^4 and yaml as runtime dependencies.
- 03b044b: Add OpenTelemetry tracing primitives to the main entry: `initTracing()` to bootstrap the Node SDK (with optional Honeycomb OTLP export), `createTracer()` to obtain a scoped Tracer, and the `TracingOptions` and `Tracer` types. Crews call `initTracing()` once at process start and `createTracer(name)` from their `observability.ts`.
