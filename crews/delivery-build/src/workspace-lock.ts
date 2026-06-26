/**
 * Serialises engineer workspace operations on the shared project checkout.
 * One story's git/Bash work completes before the next begins.
 */
let workspaceChain: Promise<void> = Promise.resolve();

export function withWorkspaceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = workspaceChain.then(fn);
  workspaceChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Reset the lock chain between tests. */
export function resetWorkspaceLock(): void {
  workspaceChain = Promise.resolve();
}
