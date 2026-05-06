import { createLogger, createTracer } from "@daddia/crew";

export const log = createLogger("delivery-build");
export const tracer = createTracer("delivery-build");
