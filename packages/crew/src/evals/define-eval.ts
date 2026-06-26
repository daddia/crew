import type { EvalDefinition } from './types.js';

/** Declare a CrewBench eval module (default export from `*.eval.ts`). */
export function defineEval(definition: EvalDefinition): EvalDefinition {
  if (!definition.name?.trim()) {
    throw new Error('defineEval: name is required');
  }
  if (typeof definition.run !== 'function') {
    throw new Error('defineEval: run must be a function');
  }
  return definition;
}
