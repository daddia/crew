# Tooling

Shared build, lint, format, and test configuration for HelmIQ repositories.

Each directory is a workspace package published under the `@repo/*` namespace. This directory is mastered in the `crew` monorepo and can be copied into other HelmIQ projects.

## Packages

| Package | Name | Purpose |
|---|---|---|
| `typescript-config/` | `@repo/typescript-config` | Shared base tsconfig and per-framework variants |
| `eslint-config/` | `@repo/eslint-config` | Shared ESLint flat config with base, library, and framework variants |
| `prettier-config/` | `@repo/prettier-config` | Shared Prettier config |
| `tailwind-config/` | `@repo/tailwind-config` | Shared Tailwind CSS and PostCSS config |
| `vitest-config/` | `@repo/vitest-config` | Shared Vitest config with base and UI variants |

## Usage

**Copy into a new project and include in `pnpm-workspace.yaml`:**

```yaml
packages:
  - 'packages/*'
  - 'tooling/*'
```

**Extend TypeScript config:**

```json
{
  "extends": "@repo/typescript-config/base",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Use Prettier config (in consumer `package.json`):**

```json
{
  "prettier": "@repo/prettier-config"
}
```

**Extend ESLint config:**

```js
import { config as baseConfig } from '@repo/eslint-config/base';

export default [...baseConfig];
```
