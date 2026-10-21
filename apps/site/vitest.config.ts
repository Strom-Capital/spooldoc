import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Rendering every guide with Shiki takes a few seconds.
    testTimeout: 30_000,
  },
});
