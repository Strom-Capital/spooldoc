// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { shikiConfig, syntaxHighlight } from './src/lib/shiki.ts';

// Served from the custom domain in public/CNAME, by GitHub Pages
// (.github/workflows/pages.yml).
export default defineConfig({
  site: 'https://spooldoc.com',
  base: '/',
  integrations: [sitemap()],
  // The stylesheets are small; inlining them saves render-blocking requests on mobile.
  build: { inlineStylesheets: 'always' },
  // Mermaid's diagram chunks are large. Mermaid.astro loads them only on a guide with a diagram.
  vite: { build: { chunkSizeWarningLimit: 1600 } },
  markdown: {
    // The guides render without smartypants, as in the app; the blog follows them.
    processor: unified({ smartypants: false }),
    syntaxHighlight: { ...syntaxHighlight, excludeLangs: [...syntaxHighlight.excludeLangs] },
    shikiConfig: { ...shikiConfig, transformers: [...shikiConfig.transformers] },
  },
});
