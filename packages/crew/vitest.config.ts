import { mergeConfig } from 'vitest/config';
import { baseConfig } from '@repo/vitest-config/base';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseConfig, {
  resolve: {
    alias: {
      '@daddia/crew/webhooks': resolve(__dirname, './src/webhooks/index.ts'),
      '@daddia/crew/config': resolve(__dirname, './src/config/index.ts'),
      '@daddia/crew/state': resolve(__dirname, './src/state/index.ts'),
      '@daddia/crew/workflow': resolve(__dirname, './src/workflow/index.ts'),
      '@daddia/crew': resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    tsconfig: './tsconfig.test.json',
  },
});
