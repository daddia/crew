import { createLogger } from '@daddia/crew';

export const log = createLogger('delivery-build');

// createTracer is not exported by the currently installed build of @daddia/crew.
// Export a stub so consumers that import `tracer` continue to compile; the stub
// is safe to replace with real instrumentation once the package is updated.
export const tracer: Record<string, unknown> = {};
