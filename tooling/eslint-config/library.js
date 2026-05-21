import globals from 'globals';
import { config as baseConfig } from './base.js';

/**
 * A custom ESLint configuration for Node.js libraries.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const libraryConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    ignores: ['.*.js', 'node_modules/', 'dist/'],
  },
  // Ban direct access of individual keys from process.env in src files.
  // The selector targets `process.env.KEY` and `process.env["KEY"]` but
  // intentionally does NOT fire on bare `process.env` (e.g. default-param
  // pass-through in the entry point), because that pattern does not read a
  // specific variable — it just forwards the environment dictionary.
  {
    files: ['src/**/*.ts', 'src/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'Direct process.env key access is banned outside config.ts. ' +
            'Add the variable to src/config.ts and consume it through the ' +
            'injected Config object.',
        },
      ],
    },
  },
  // Allow process.env access inside config.ts — that file IS the designated
  // boundary between the raw environment and the typed, validated Config.
  {
    files: ['**/config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];

export default libraryConfig;
