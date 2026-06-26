import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EvalRunResult } from '../types.js';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function classNameFor(result: EvalRunResult): string {
  return `eval.${result.evalName}`;
}

function failureMessages(result: EvalRunResult): string[] {
  const messages: string[] = [];
  for (const assertion of result.assertions) {
    if (!assertion.passed) {
      const tag = assertion.severity === 'soft' ? 'soft' : 'gate';
      messages.push(`[${tag}] ${assertion.name}`);
    }
  }
  if (!result.passed && messages.length === 0) {
    messages.push(`session success=${result.session.success}: ${result.session.summary}`);
  }
  return messages;
}

/** Render eval results as JUnit XML for CI consumers. */
export function renderJUnit(results: EvalRunResult[]): string {
  const failures = results.filter((r) => !r.passed).length;
  const totalTimeSec = results.reduce((sum, r) => sum + r.durationMs, 0) / 1000;

  const testcases = results
    .map((result) => {
      const timeSec = (result.durationMs / 1000).toFixed(3);
      const className = escapeXml(classNameFor(result));
      const name = escapeXml(result.evalName);
      const messages = failureMessages(result);

      if (messages.length === 0) {
        return `    <testcase classname="${className}" name="${name}" time="${timeSec}" />`;
      }

      const body = escapeXml(messages.join('\n'));
      return (
        `    <testcase classname="${className}" name="${name}" time="${timeSec}">` +
        `\n      <failure message="${body}">${body}</failure>` +
        `\n    </testcase>`
      );
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="crew-eval" tests="${results.length}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">\n` +
    `${testcases}\n` +
    `</testsuite>\n`
  );
}

export async function writeJUnitReport(
  results: EvalRunResult[],
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderJUnit(results), 'utf8');
}
