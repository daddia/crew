import type { EvalAssertion, EvalContext, EvalSessionResult } from './types.js';

export function createEvalContext(session: EvalSessionResult): EvalContext & {
  assertions: EvalAssertion[];
} {
  const assertions: EvalAssertion[] = [];

  function record(
    name: string,
    passed: boolean,
    severity: EvalAssertion['severity'],
    message?: string,
  ): void {
    assertions.push({ name, severity, passed, message });
  }

  const ctx: EvalContext & { assertions: EvalAssertion[] } = {
    session,
    assertions,
    succeeded() {
      record('session succeeded', session.success, 'gate', session.summary);
    },
    expect(condition: boolean, message: string) {
      record(message, condition, 'gate');
    },
    soft: {
      expect(condition: boolean, message: string) {
        record(message, condition, 'soft');
      },
    },
  };

  return ctx;
}

export function evalPassed(assertions: ReadonlyArray<EvalAssertion>, strict: boolean): boolean {
  return assertions.every((a) => a.passed || (a.severity === 'soft' && !strict));
}
