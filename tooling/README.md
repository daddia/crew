# Tooling

Shared build, lint, format, and test configuration for the **crew** monorepo.

Each directory is a workspace package under `@repo/*`, listed in `pnpm-workspace.yaml` as `tooling/*`.

## Packages

| Package              | Name                      | Purpose                                                         |
| -------------------- | ------------------------- | --------------------------------------------------------------- |
| `typescript-config/` | `@repo/typescript-config` | Shared base `tsconfig` and optional framework-flavoured extends |
| `eslint-config/`     | `@repo/eslint-config`     | Shared ESLint flat config (base, library)                       |
| `prettier-config/`   | `@repo/prettier-config`   | Shared Prettier config                                          |
| `vitest-config/`     | `@repo/vitest-config`     | Shared Vitest config (base and UI variants)                     |

## Usage

**Include in `pnpm-workspace.yaml` (already done in this repo):**

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
