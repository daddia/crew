import { createLogger, createTracer } from "@daddia/crew";

export const log = createLogger("delivery-review");
export const tracer = createTracer("delivery-review");
