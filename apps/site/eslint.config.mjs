import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['src/**/*.{ts,astro}'],
    rules: { 'no-console': 'error' },
  },
);
