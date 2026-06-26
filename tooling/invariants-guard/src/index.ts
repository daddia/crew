import { checkCrossCrewImports } from './rules/cross-crew-imports.js';
import { checkDuplicateSkillTrees } from './rules/duplicate-skill-trees.js';
import { checkProcessEnv } from './rules/process-env.js';
import { checkUpsertBeforeAgentRun } from './rules/upsert-before-agent-run.js';
import type { Violation } from './types.js';

export type { Violation } from './types.js';
export { formatViolation } from './types.js';
export { checkProcessEnv, checkProcessEnvInFile } from './rules/process-env.js';
export {
  checkUpsertBeforeAgentRun,
  checkUpsertBeforeAgentRunContent,
} from './rules/upsert-before-agent-run.js';
export { checkCrossCrewImports } from './rules/cross-crew-imports.js';
export { checkDuplicateSkillTrees } from './rules/duplicate-skill-trees.js';

export interface GuardOptions {
  repoRoot: string;
  crewsDir?: string;
}

export async function runInvariantGuard(options: GuardOptions): Promise<Violation[]> {
  const crewsDir = options.crewsDir ?? `${options.repoRoot}/crews`;
  const results = await Promise.all([
    checkProcessEnv(crewsDir),
    checkUpsertBeforeAgentRun(crewsDir),
    checkCrossCrewImports(crewsDir),
    checkDuplicateSkillTrees(crewsDir),
  ]);
  return results.flat();
}
