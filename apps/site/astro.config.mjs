// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import { rehypeImageLinks } from './src/lib/imageLinks.ts';
import { gitFileDate, postDates, sitemapLastmod } from './src/lib/lastmod.ts';
import { shikiConfig, syntaxHighlight } from './src/lib/shiki.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** When each page last changed, from git and the posts' dates (src/lib/lastmod.ts). */
const lastmodSources = {
  fileDate: (/** @type {string} */ file) => gitFileDate(root, file),
  posts: postDates(fileURLToPath(new URL('./src/content/blog', import.meta.url))),
};

// Served from the custom domain in public/CNAME, by GitHub Pages
// (.github/workflows/pages.yml).
export default defineConfig({
  site: 'https://spooldoc.com',
  base: '/',
  integrations: [
    sitemap({
      // A page without an honest date goes without <lastmod>.
      serialize(item) {
        const lastmod = sitemapLastmod(new URL(item.url).pathname, lastmodSources);
        return lastmod ? { ...item, lastmod: lastmod.toISOString() } : item;
      },
    }),
  ],
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
