# `@repo/eslint-config`

Shared ESLint flat configurations used by the **crew** monorepo and portable to other pnpm workspaces.

## Available configs

| Export                               | Use case                                                      | Used in crew today        |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------- |
| `@repo/eslint-config/base`           | Base config (TypeScript + Prettier + Turbo)                   | Yes                       |
| `@repo/eslint-config/library`        | Node.js library packages (`packages/*`) and crews (`crews/*`) | Yes                       |
| `@repo/eslint-config/nest-js`        | NestJS applications                                           | No (kept for portability) |
| `@repo/eslint-config/next-js`        | Next.js applications                                          | No (kept for portability) |
| `@repo/eslint-config/react-internal` | Shared React component libraries                              | No (kept for portability) |

Project-level `eslint.config.mjs` files import a config and add overrides:

```js
import { config as baseConfig } from '@repo/eslint-config/base';

export default [...baseConfig];
```
