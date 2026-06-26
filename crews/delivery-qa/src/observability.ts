import { createLogger, createTracer } from '@daddia/crew';

export const log = createLogger('delivery-qa');
export const tracer = createTracer('delivery-qa');
