import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['docs/lib/test/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
