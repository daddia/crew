/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-crew-imports',
      comment:
        'Agent crews must not import from other agent crews. ' +
        'Shared code belongs in packages/*.',
      severity: 'error',
      from: { path: '^crews/([^/]+)/' },
      to: {
        path: '^crews/',
        pathNot: '^crews/$1/',
      },
    },
    {
      name: 'no-packages-importing-crews',
      comment: 'Shared packages must not depend on agent crews.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^crews/' },
    },
    {
      name: 'no-crews-outside-own-scope',
      comment: 'Agent crews may only import from their own src tree or from packages/*.',
      severity: 'error',
      from: { path: '^crews/([^/]+)/src/' },
      to: {
        pathNot: ['^crews/$1/', '^packages/', '^node_modules/'],
        dependencyTypesNot: ['core'],
      },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    moduleSystems: ['cjs', 'es6'],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
