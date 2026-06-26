export interface Violation {
  ruleId: string;
  filePath: string;
  line: number;
  message: string;
}

export function formatViolation(v: Violation, repoRoot: string): string {
  const relative = v.filePath.startsWith(repoRoot)
    ? v.filePath.slice(repoRoot.length + 1)
    : v.filePath;
  return `${relative}:${v.line} [${v.ruleId}] ${v.message}`;
}
