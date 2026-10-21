import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * When each page last changed, for the sitemap's `<lastmod>` and the guides' JSON-LD. A
 * guide or a page changes with the last commit to its source file, a post on its date. A
 * page with no honest date gets none: never the time of the build.
 */

/** What a page's date is read from. Files are paths from the repository root. */
export interface LastmodSources {
  /** The date of the last commit to a file; undefined when git can't tell. */
  fileDate: (file: string) => Date | undefined;
  /** Each published post's date, by its id. */
  posts: Map<string, Date>;
}

/** The files the pages outside the guides and the blog are made from. */
const PAGE_SOURCES: Record<string, string[]> = {
  '/': ['apps/site/src/pages/index.astro', 'apps/site/src/lib/features.ts'],
  '/features/': ['apps/site/src/pages/features.astro', 'apps/site/src/lib/features.ts'],
  '/changelog/': ['CHANGELOG.md'],
};

/**
 * The date a page last changed, or undefined when there is no honest one.
 *
 * @param pathname - The page's path on the site, such as `/docs/jobs/`
 */
export function sitemapLastmod(pathname: string, { fileDate, posts }: LastmodSources): Date | undefined {
  const page = pathname.endsWith('/') ? pathname : `${pathname}/`;
  if (page === '/docs/') return fileDate('docs/README.md');
  const [, slug] = /^\/docs\/([\w-]+)\/$/.exec(page) ?? [];
  if (slug) return fileDate(`docs/${slug}.md`);
  if (page === '/blog/') return latest([...posts.values()]);
  const [, post] = /^\/blog\/([\w-]+)\/$/.exec(page) ?? [];
  if (post) return posts.get(post);
  return latest((PAGE_SOURCES[page] ?? []).map(fileDate));
}

function latest(dates: (Date | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>((newest, date) => (date && (!newest || date > newest) ? date : newest), undefined);
}

const commitDates = new Map<string, Date | undefined>();
/** Whether each repository has its full history, by its root. */
const fullHistory = new Map<string, boolean>();

/**
 * The date of the last commit that touched a file. Undefined when git is missing, the file
 * is not committed, or the clone is shallow: there every file would get the one commit's date.
 *
 * @param root - The repository root
 * @param file - The file, from the repository root
 */
export function gitFileDate(root: string, file: string): Date | undefined {
  if (!fullHistory.has(root)) fullHistory.set(root, git(root, ['rev-parse', '--is-shallow-repository']) === 'false');
  if (!fullHistory.get(root)) return undefined;
  const key = path.join(root, file);
  if (!commitDates.has(key)) {
    const date = git(root, ['log', '-1', '--format=%cI', '--', file]);
    commitDates.set(key, date ? new Date(date) : undefined);
  }
  return commitDates.get(key);
}

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    // No git, or not a repository: the pages go without a date.
    return undefined;
  }
}

/**
 * Each published post's date, read from the files in src/content/blog, as the sitemap
 * integration runs outside Astro's content layer. The id drops the date prefix, as in
 * content.config.ts. The schema has no updated date, so the date is the post's own.
 */
export function postDates(folder: string): Map<string, Date> {
  const dates = new Map<string, Date>();
  for (const file of fs.readdirSync(folder).filter((name) => /^[^_].*\.md$/.test(name))) {
    const header = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(path.join(folder, file), 'utf8'))?.[1] ?? '';
    const [, date] = /^date: (.+)$/m.exec(header) ?? [];
    if (!date || /^draft: true$/m.test(header)) continue;
    dates.set(file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''), new Date(date.trim()));
  }
  return dates;
}
