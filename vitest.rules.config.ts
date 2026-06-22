import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Rules specs live directly under tests/; exclude tests/e2e/** — those need
    // the Functions emulator, which `pnpm test:rules` does not start.
    include: ['tests/*.{test,spec}.{js,ts}'],
    testTimeout: 30000,
  },
});
