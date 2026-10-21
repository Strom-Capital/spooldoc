// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import { rehypeImageLinks } from './src/lib/imageLinks.ts';
import { shikiConfig, syntaxHighlight } from './src/lib/shiki.ts';

// Served from the custom domain in public/CNAME, by GitHub Pages
// (.github/workflows/pages.yml).
export default defineConfig({
  site: 'https://spooldoc.com',
  base: '/',
  integrations: [sitemap()],
  // The stylesheets are small; inlining them saves render-blocking requests on mobile.
  build: { inlineStylesheets: 'always' },
  markdown: {
    // The guides render without smartypants, as in the app; the blog follows them.
    // Images in posts open full size when clicked, as in the guides (src/lib/imageLinks.ts).
    processor: unified({ smartypants: false, rehypePlugins: [rehypeRaw, rehypeImageLinks] }),
    syntaxHighlight: { ...syntaxHighlight, excludeLangs: [...syntaxHighlight.excludeLangs] },
    shikiConfig: { ...shikiConfig, transformers: [...shikiConfig.transformers] },
  },
});
