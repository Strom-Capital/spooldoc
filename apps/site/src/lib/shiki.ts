import { shikiContrast } from './shikiContrast';

/**
 * Code highlighting for the blog, the guides and CodeBlock.astro: GitHub's themes, as in
 * the app, both written out (defaultColor: false) so global.css picks one with the page
 * theme.
 */
export const shikiConfig = {
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: false,
  transformers: [shikiContrast],
} as const;

export const syntaxHighlight = { type: 'shiki', excludeLangs: ['math'] } as const;
