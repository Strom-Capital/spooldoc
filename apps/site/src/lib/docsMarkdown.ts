import { docsUrl, url } from './links';

/**
 * A guide as a Markdown file that stands alone, for /docs/<slug>.md and /llms-full.txt:
 * the title and description on top, then the body the page renders, with every link and
 * image on this site made an absolute URL.
 */
export function docsMarkdown({ title, description, slug, markdown, site }: { title: string; description: string; slug?: string; markdown: string; site: URL }): string {
  const page = docsUrl(slug);
  return `# ${title}\n\n> ${description}\n\nSource: ${new URL(page, site).href}\n\n${absoluteDocsMarkdown(markdown, site, page).trim()}\n`;
}

/**
 * The guide Markdown from lib/docs.ts with absolute links: `/docs/jobs#versions` becomes
 * `https://spooldoc.com/docs/jobs/#versions`, with the trailing slash the pages are served
 * at, `#versions` gets the page's own URL, and each light and dark screenshot pair becomes
 * one Markdown image of the light one. Code blocks are left as they are.
 *
 * @param page - The guide's path, such as `/docs/jobs/`, for its `#` links
 */
export function absoluteDocsMarkdown(markdown: string, site: URL, page: string): string {
  const abs = (target: string) => new URL(target.startsWith('#') ? `${page}${target}` : url(withSlash(target)), site).href;
  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
      if (marker && (!fence || marker.startsWith(fence))) {
        fence = fence ? undefined : marker;
        return line;
      }
      if (fence) return line;
      return line
        .replace(THEME_IMAGES, (_, src: string, alt: string) => `![${alt.replace(/[[\]]/g, '\\$&')}](${abs(src)})`)
        .replace(/(\]\()([/#][^()\s]*)(\))/g, (_, open: string, target: string, close: string) => `${open}${abs(target)}${close}`)
        .replace(/(\s(?:href|src)=")(\/[^"]*)(")/g, (_, open: string, target: string, close: string) => `${open}${abs(target)}${close}`);
    })
    .join('\n');
}

/** The light and dark images rewriteDocsMarkdown makes of a guide's `<picture>`, on one line. */
const THEME_IMAGES = /<p align="center"><img data-theme-image="light" src="([^"]+)" alt="([^"]*)"[^>]*><img data-theme-image="dark"[^>]*><\/p>/g;

/** `/docs/jobs#versions` as `/docs/jobs/#versions`, as siteDocsHtml does; other paths as they are. */
function withSlash(target: string): string {
  return target.replace(/^\/docs(\/[\w-]+)?(#.*)?$/, (_, page = '', hash = '') => `/docs${page}/${hash}`);
}
