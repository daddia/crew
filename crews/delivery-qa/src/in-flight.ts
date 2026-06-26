/**
 * Singleton set of issueKeys whose workflow is currently executing in this
 * process. Shared between the poller and webhook handlers so that a duplicate
 * webhook cannot start a second workflow for the same story.
 *
 * The raw set is exported so tests can reset it between runs via `.clear()`.
 */
export const inFlight = new Set<string>();

export function acquire(issueKey: string): void {
  inFlight.add(issueKey);
}

export function release(issueKey: string): void {
  inFlight.delete(issueKey);
}

export function has(issueKey: string): boolean {
  return inFlight.has(issueKey);
}

/**
 * Acquire the in-flight lock for issueKey and dispatch the workflow function.
 * The lock is released when `fn()` settles (success or error); errors from
 * `fn` are passed to `onError`.
 *
 * The lock is acquired synchronously so a concurrent caller observes
 * `has(issueKey)` before this function returns. Set `deferred: true` to
 * start `fn()` on the next tick via `setImmediate` — webhook handlers use
 * this so the HTTP response can flush before the workflow's synchronous
 * prefix runs. The poller calls without `deferred` because it has no
 * response to flush.
 */
export function runQaWorkflowWithLock(
  issueKey: string,
  fn: () => Promise<unknown>,
  onError: (err: unknown) => void,
  options: { deferred?: boolean } = {},
): void {
  acquire(issueKey);
  const start = (): void => {
    void fn()
      .catch(onError)
      .finally(() => {
        release(issueKey);
      });
  };
  if (options.deferred) {
    setImmediate(start);
  } else {
    start();
  }
}
