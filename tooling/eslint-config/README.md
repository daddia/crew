# `@repo/eslint-config`

Shared ESLint flat configurations for HelmIQ repositories.

## Available configs

| Export                                | Use case                                    |
| ------------------------------------- | ------------------------------------------- |
| `@repo/eslint-config/base`          | Base config (TypeScript + Prettier + Turbo) |
| `@repo/eslint-config/library`       | Node.js library packages (`packages/*`)     |
| `@repo/eslint-config/nest-js`       | NestJS applications (`apps/api`)            |
| `@repo/eslint-config/next-js`       | Next.js applications (`apps/web`)           |
| `@repo/eslint-config/react-internal`| Shared React component libraries            |

Project-level `eslint.config.mjs` files import a config and add overrides.
