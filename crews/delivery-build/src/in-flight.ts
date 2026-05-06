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
