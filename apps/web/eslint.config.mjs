import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: ['.next/', 'node_modules/', 'next-env.d.ts'] },
  {
    files: ['app/**', 'components/**', 'lib/**', 'proxy.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    // Copied from the shadcn/ui and AI Elements registries. Kept close to upstream
    // so `npx shadcn add` and `npx ai-elements add` can update them.
    files: ['components/ui/**', 'components/ai-elements/**'],
    rules: {
      'no-console': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

export default config;
