/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Astro's Vite setup, so tests can render .astro components with the container API.
export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Rendering every guide with Shiki takes a few seconds.
    testTimeout: 30_000,
  },
});
