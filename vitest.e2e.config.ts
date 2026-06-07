/*
 * Vitest config for emulator-driven end-to-end (e2e) tests.
 *
 * These tests exercise the real Cloud Functions Firestore triggers against the
 * Firebase emulator (Firestore + Functions). They are NOT run by the default
 * `pnpm test`; run them with `pnpm test:e2e`, which starts the emulators via
 * `firebase emulators:exec` and then runs this config.
 *
 * Tests live under tests/e2e/ and are named `<story-id>.spec.ts`, with the
 * story ID in the top-level describe (e.g.
 * `describe('story: grading-event-managers', …)`).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/e2e/**/*.{test,spec}.{js,ts}'],
    // Triggers fire asynchronously and the emulator can be slow to warm up.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run serially: tests share the same emulator Firestore namespace.
    fileParallelism: false,
  },
});
