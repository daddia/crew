/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-agent-imports",
      comment:
        "Agent units must not import from other agent units. " +
        "Shared code belongs in packages/*.",
      severity: "error",
      from: { path: "^agents/([^/]+)/" },
      to: {
        path: "^agents/",
        pathNot: "^agents/$1/",
      },
    },
    {
      name: "no-packages-importing-agents",
      comment: "Shared packages must not depend on agent units.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^agents/" },
    },
    {
      name: "no-agents-outside-own-scope",
      comment:
        "Agent units may only import from their own src tree or from packages/*.",
      severity: "error",
      from: { path: "^agents/([^/]+)/src/" },
      to: {
        pathNot: ["^agents/$1/", "^packages/", "^node_modules/"],
        dependencyTypesNot: ["core"],
      },
    },
  ],

  options: {
    doNotFollow: {
      path: "node_modules",
    },
    moduleSystems: ["cjs", "es6"],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
