import { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';

// The selector and message that library.js injects for the process.env ban.
// Mirrored here so this file is the single reference that proves the rule
// fires and is disabled in the right places.
const RULE_CONFIG = [
  'error',
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
    message:
      'Direct process.env key access is banned outside config.ts. ' +
      'Add the variable to src/config.ts and consume it through the ' +
      'injected Config object.',
  },
];

// Config objects that mirror the structure used in library.js.
// files must be explicit because ESLint v9+ flat config does not apply
// rules to .ts files unless they are included in a files pattern.
const RULE_ON = {
  files: ['**/*.ts', '**/*.js'],
  rules: { 'no-restricted-syntax': RULE_CONFIG },
};
const RULE_OFF_FOR_CONFIG = {
  files: ['**/config.ts'],
  rules: { 'no-restricted-syntax': 'off' },
};

describe('no-restricted-syntax: process.env key-access ban', () => {
  const linter = new Linter();

  it('fires on process.env["KEY"] in a non-config src file', () => {
    const messages = linter.verify('const x = process.env["JIRA_PROJECT_KEY"];', [RULE_ON], {
      filename: 'crews/delivery-build/src/poller.ts',
    });
    const hits = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain('config.ts');
  });

  it('fires on process.env.KEY in a non-config src file', () => {
    const messages = linter.verify('const x = process.env.JIRA_PROJECT_KEY;', [RULE_ON], {
      filename: 'crews/delivery-build/src/poller.ts',
    });
    const hits = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('does not fire inside config.ts when the override is applied', () => {
    const messages = linter.verify(
      'const x = process.env["JIRA_PROJECT_KEY"];',
      [RULE_ON, RULE_OFF_FOR_CONFIG],
      { filename: 'crews/delivery-build/src/config.ts' },
    );
    const hits = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits).toHaveLength(0);
  });

  it('does not fire on bare process.env used as an object reference', () => {
    // Passing process.env as a dictionary (no specific key read) must not trigger
    // the rule, since that pattern is used in the entry point to forward the
    // full environment to loadConfig().
    const messages = linter.verify(
      'export async function boot(env = process.env) { return env; }',
      [RULE_ON],
      { filename: 'crews/delivery-build/src/index.ts' },
    );
    const hits = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits).toHaveLength(0);
  });
});
