import fs from 'node:fs';
import path from 'node:path';
import * as docs from '@spooldoc/docs';
import type { DocsGroup, DocsHeading, DocsOptions, DocsPage, DocsSection } from '@spooldoc/docs';
import { GITHUB } from './links';

export type { DocsGroup, DocsHeading, DocsNavPage, DocsPage, DocsSection } from '@spooldoc/docs';

/**
 * The guides in docs/ at the repository root, read at build time with @spooldoc/docs,
 * the same reader the app uses. Astro builds and the tests run from apps/site.
 */

/** The repository root. */
export function repoRoot(): string {
  return path.resolve(process.cwd(), '../..');
}

/** The docs/ folder at the repository root. */
export function docsFolder(): string {
  return path.join(repoRoot(), 'docs');
}

/** The version in the root package.json: the latest release, the tag without its `v`. */
export function siteVersion(): string {
  const file = path.join(repoRoot(), 'package.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
}

let options: DocsOptions | undefined;

export function docsOptions(): DocsOptions {
  options ??= { folder: docsFolder(), repository: GITHUB, version: siteVersion() };
  return options;
}

/** The sidebar: each `##` group of docs/README.md and the pages in its table. */
export function docsNav(): DocsGroup[] {
  return docs.docsNav(docsOptions());
}

/** One guide, with its Markdown rewritten for /docs. */
export function docsPage(slug: string): DocsPage {
  return docs.docsPage(slug, docsOptions());
}

/** Every section of every guide, for search. */
export function docsSections(): DocsSection[] {
  return docs.docsSections(docsOptions());
}

/** Every guide's slug, in the order of the sidebar. */
export function docsSlugs(): string[] {
  return docsNav().flatMap(({ pages }) => pages.map(({ slug }) => slug));
}

/** The meta description of /docs, which docs/README.md has no front matter for. */
export const DOCS_INDEX_DESCRIPTION = 'The Spooldoc guides: install, use and run Spooldoc, and develop it.';

/**
 * docs/README.md, which is /docs: its `#` heading as the title, and the rest rewritten
 * like any guide. It has no front matter, so the reader's docsPage does not take it.
 */
export function docsIndex(): { title: string; markdown: string; headings: DocsHeading[] } {
  const source = fs.readFileSync(path.join(docsFolder(), 'README.md'), 'utf8');
  const [, title = 'Documentation'] = /^# (.+)$/m.exec(source) ?? [];
  const body = source.replace(/^# .+\n+/m, '');
  const headings = docs
    .docsHeadings(body)
    .filter((heading): heading is DocsHeading => heading.depth === 2 || heading.depth === 3);
  return { title, markdown: docs.rewriteDocsMarkdown(body, docsOptions()), headings };
}

/** The images in docs/assets, which the site serves at /docs/assets. Subfolders are left out. */
export function docsAssets(): string[] {
  return fs
    .readdirSync(path.join(docsFolder(), 'assets'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && path.extname(entry.name).toLowerCase() in ASSET_TYPES)
    .map((entry) => entry.name)
    .sort();
}

export const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** The size a screenshot in docs/assets shows at, scaled to `width`. */
export function assetSize(file: string, width?: number): { width: number; height: number } {
  return docs.docsImageSize(`assets/${file}`, docsOptions(), width);
}

/**
 * Rendered guide HTML with the links between guides pointing at the trailing-slash URLs
 * the site is served at, `/docs/jobs/#versions` for `/docs/jobs#versions`, so no link
 * goes through a redirect. Links to /docs/assets are left alone.
 */
export function siteDocsHtml(html: string): string {
  return html.replace(/(href=")\/docs(\/[\w-]+)?(#[^"]*)?"/g, (_, open: string, page = '', hash = '') => `${open}/docs${page}/${hash}"`);
}
