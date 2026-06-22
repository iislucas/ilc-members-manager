/*
 * Vitest config for the fixture-integrity unit tests (tests/unit/**).
 *
 * These are plain Node tests that read the committed fixture JSON directly and
 * assert it is a closed, anonymized graph (referential integrity / role coverage
 * / PII hygiene). They need no emulator, so they are fast and CI-friendly.
 *
 *   pnpm test:fixtures
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
  },
});
