import { createLogger, createTracer } from '@daddia/crew';

export const log = createLogger('{{CREW_NAME}}');
export const tracer = createTracer('{{CREW_NAME}}');
