import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import type { Violation } from '../types.js';

function isAgentRunCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.name.text !== 'run') return false;

  const obj = node.expression.expression;
  if (ts.isIdentifier(obj)) {
    return obj.text === 'engineer' || obj.text === 'seniorEngineer';
  }
  if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'agent') {
    return true;
  }
  return false;
}

function getEnclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function collectAgentRunsInFunction(func: ts.FunctionLikeDeclaration): ts.CallExpression[] {
  const runs: ts.CallExpression[] = [];
  const body = func.body;
  if (!body) return runs;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isAgentRunCall(node)) {
      runs.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return runs.sort((a, b) => a.getStart() - b.getStart());
}

function checkWorkflowSource(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const text = sourceFile.getFullText();
  const seenFunctions = new Set<ts.FunctionLikeDeclaration>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isAgentRunCall(node)) {
      const func = getEnclosingFunction(node);
      if (!func?.body || seenFunctions.has(func)) {
        ts.forEachChild(node, visit);
        return;
      }

      const runs = collectAgentRunsInFunction(func);
      for (const run of runs) {
        const runStart = run.getStart(sourceFile);
        const bodyStart = func.body!.getStart(sourceFile);
        const priorRuns = runs.filter((r) => r.getStart(sourceFile) < runStart);
        const searchStart =
          priorRuns.length > 0 ? priorRuns[priorRuns.length - 1]!.getEnd() : bodyStart;
        const segment = text.slice(searchStart, runStart);
        if (!/\.upsertStory\s*\(/.test(segment)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(run.getStart(sourceFile));
          violations.push({
            ruleId: 'crash-recovery-upsert-before-agent-run',
            filePath: sourceFile.fileName,
            line: line + 1,
            message: 'upsertStory must be called before agent.run()',
          });
        }
      }
      seenFunctions.add(func);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function findWorkflowFiles(crewsDir: string): Promise<string[]> {
  const files: string[] = [];
  let crewEntries;
  try {
    crewEntries = await readdir(crewsDir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const crew of crewEntries) {
    if (!crew.isDirectory()) continue;
    const workflowPath = join(crewsDir, crew.name, 'src', 'workflow.ts');
    try {
      await readFile(workflowPath, 'utf8');
      files.push(workflowPath);
    } catch {
      // crew has no workflow.ts yet
    }
  }
  return files;
}

/** Ensure crash-recovery markers precede every agent.run() in crew workflow.ts files. */
export async function checkUpsertBeforeAgentRun(crewsDir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const workflowFiles = await findWorkflowFiles(crewsDir);

  for (const filePath of workflowFiles) {
    const content = await readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    violations.push(...checkWorkflowSource(sourceFile));
  }

  return violations;
}

export function checkUpsertBeforeAgentRunContent(filePath: string, content: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  return checkWorkflowSource(sourceFile);
}
