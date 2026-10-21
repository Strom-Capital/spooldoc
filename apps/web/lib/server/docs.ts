import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';

/**
 * The guides in docs/, served at /docs. The folder is read only while `next build`
 * prerenders the docs routes: the Docker image has no docs/ folder at runtime.
 * docs/README.md is the one source of the order and the groups, on GitHub and here.
 */

const REPOSITORY = 'https://github.com/Strom-Capital/spooldoc';

/** A page in the sidebar. */
export interface DocsNavPage {
  slug: string;
  title: string;
  description: string;
}

/** A `##` group of docs/README.md and the pages listed under it. */
export interface DocsGroup {
  group: string;
  pages: DocsNavPage[];
}

/** A `##` or `###` heading, for the contents list. `id` is GitHub's anchor for it. */
export interface DocsHeading {
  depth: 2 | 3;
  text: string;
  id: string;
}

export interface DocsPage {
  slug: string;
  title: string;
  description: string;
  /** The body without its front matter, with links and pictures rewritten for /docs. */
  markdown: string;
  headings: DocsHeading[];
}

/** A stretch of a page under one heading, for search. The intro has the page title and no anchor. */
export interface DocsSection {
  page: string;
  pageTitle: string;
  heading: string;
  anchor: string;
  text: string;
}

/** The docs/ folder at the repository root. */
export function docsFolder(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), '../../docs');
}

/** The version in the root package.json, which is the release tag without its `v`. */
export function docsVersion(): string {
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), '../../package.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
}

/** The sidebar: each `##` group of docs/README.md and the pages in its table. */
export function docsNav(): DocsGroup[] {
  const readme = fs.readFileSync(path.join(docsFolder(), 'README.md'), 'utf8');
  const groups: DocsGroup[] = [];
  for (const line of readme.split('\n')) {
    const [, group] = /^## (.+)$/.exec(line) ?? [];
    if (group) {
      groups.push({ group: group.trim(), pages: [] });
      continue;
    }
    const [, title, slug] = /^\| \[([^\]]+)\]\(([\w-]+)\.md\) \|/.exec(line) ?? [];
    const current = groups.at(-1);
    if (title && slug && current) {
      current.pages.push({ slug, title, description: docsPage(slug).description });
    }
  }
  return groups;
}

const pages = new Map<string, DocsPage>();

/**
 * One guide: its front matter, its Markdown ready for the app and its headings.
 *
 * @param slug - The file name without `.md`, such as `templates`
 */
export function docsPage(slug: string): DocsPage {
  const cached = pages.get(slug);
  if (cached) {
    return cached;
  }
  if (!/^[\w-]+$/.test(slug) || slug === 'README') {
    throw new Error(`There is no docs page "${slug}".`);
  }
  const file = `${slug}.md`;
  const { fields, body } = frontMatter(fs.readFileSync(path.join(docsFolder(), file), 'utf8'), file);
  const page: DocsPage = {
    slug,
    title: fields.title,
    description: fields.description,
    markdown: rewriteDocsMarkdown(body, docsVersion()),
    headings: docsHeadings(body).filter((heading): heading is DocsHeading => heading.depth === 2 || heading.depth === 3),
  };
  pages.set(slug, page);
  return page;
}

/** Every page in the order of the sidebar, cut into one section per `##` and `###` heading. */
export function docsSections(): DocsSection[] {
  return docsNav().flatMap(({ pages }) => pages.flatMap(({ slug }) => pageSections(docsPage(slug))));
}

function pageSections(page: DocsPage): DocsSection[] {
  const sections: DocsSection[] = [];
  let current: DocsSection = { page: page.slug, pageTitle: page.title, heading: page.title, anchor: '', text: '' };
  const headings = [...page.headings];
  let lines: string[] = [];
  const close = () => {
    current.text = plainText(lines.join('\n'));
    if (current.text || current.anchor) {
      sections.push(current);
    }
    lines = [];
  };
  eachLine(page.markdown, (line, inCode) => {
    if (!inCode && /^#{2,3}\s/.test(line)) {
      const heading = headings.shift()!;
      close();
      current = { page: page.slug, pageTitle: page.title, heading: heading.text, anchor: heading.id, text: '' };
      return;
    }
    lines.push(line);
  });
  close();
  return sections;
}

/**
 * Every heading of a page in order, with the anchor GitHub gives it. Anchors are counted
 * over all heading levels, as rehype-slug and GitHub do, so a repeated heading gets `-1`.
 */
export function docsHeadings(markdown: string): { depth: number; text: string; id: string }[] {
  const slugger = new GithubSlugger();
  const headings: { depth: number; text: string; id: string }[] = [];
  eachLine(markdown, (line, inCode) => {
    const [, hashes, heading] = (inCode ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)) ?? [];
    if (hashes && heading) {
      const text = inlineText(heading);
      headings.push({ depth: hashes.length, text, id: slugger.slug(text) });
    }
  });
  return headings;
}

/**
 * The body as the app shows it: links to other guides go to /docs, links outside docs/
 * go to the file on GitHub at this version, and each light and dark `<picture>` becomes
 * two images that follow the app's theme rather than the system's.
 *
 * @param version - The release, for links to files outside docs/
 */
export function rewriteDocsMarkdown(markdown: string, version: string): string {
  return mapProse(markdown, (text) =>
    text
      .replace(PICTURE, (_, dark: string, light: string, alt: string, width?: string) => {
        const image = (src: string, className: string) => {
          const size = docsImageSize(src, width ? Number(width) : undefined);
          return `<img class="${className}" src="${docsHref(src, version)}" alt="${alt}" width="${size.width}" height="${size.height}">`;
        };
        return `<p align="center">${image(light, 'dark:hidden')}${image(dark, 'hidden dark:inline')}</p>`;
      })
      .replace(/(\]\()([^)\s]+)(\))/g, (_, open: string, target: string, end: string) => `${open}${docsHref(target, version)}${end}`),
  );
}

/**
 * The size an image in docs/ shows at, so the browser keeps its space before it loads and
 * an anchor lands where it should. Read from the PNG header or the SVG's own size.
 *
 * @param src - The image as written in docs/, such as `assets/home-light.png`
 * @param width - The width the guide asks for; the height is scaled to keep the aspect ratio
 */
export function docsImageSize(src: string, width?: number): { width: number; height: number } {
  const natural = naturalSize(path.join(docsFolder(), src));
  if (!natural) {
    throw new Error(`Can't read the size of ${src} in docs/. Use a PNG, or an SVG with a viewBox or a width and height.`);
  }
  return width ? { width, height: Math.round((natural.height * width) / natural.width) } : natural;
}

function naturalSize(file: string): { width: number; height: number } | undefined {
  const data = fs.readFileSync(file);
  if (file.endsWith('.png')) {
    // The IHDR chunk comes first: width and height are the big-endian words at bytes 16 to 23.
    return data.length >= 24 && data.toString('latin1', 12, 16) === 'IHDR'
      ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
      : undefined;
  }
  if (file.endsWith('.svg')) {
    const tag = /<svg\b[^>]*>/.exec(data.toString('utf8'))?.[0] ?? '';
    const attribute = (name: string) => new RegExp(`\\s${name}="([^"]+)"`).exec(tag)?.[1];
    const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const width = Number.parseFloat(attribute('width') ?? '') || box?.[2];
    const height = Number.parseFloat(attribute('height') ?? '') || box?.[3];
    return width && height ? { width: Math.round(width), height: Math.round(height) } : undefined;
  }
  return undefined;
}

/** The light and dark screenshot block the guides use, which GitHub switches by the system theme. */
const PICTURE =
  /<p align="center">\s*<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<img src="([^"]+)" alt="([^"]*)"(?: width="(\d+)")?>\s*<\/picture>\s*<\/p>/g;

/**
 * Where a link in a guide goes in the app.
 *
 * @param target - The link as written in docs/, such as `jobs.md#versions`
 * @param version - The release, for links to files outside docs/
 */
export function docsHref(target: string, version: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) {
    return target;
  }
  const at = target.indexOf('#');
  const file = at === -1 ? target : target.slice(0, at);
  const hash = at === -1 ? '' : target.slice(at);
  const resolved = path.posix.normalize(`docs/${file}`);
  const inDocs = resolved.startsWith('docs/') ? resolved.slice('docs/'.length) : undefined;
  if (inDocs === 'README.md') {
    return `/docs${hash}`;
  }
  if (inDocs && /^[\w-]+\.md$/.test(inDocs)) {
    return `/docs/${inDocs.slice(0, -'.md'.length)}${hash}`;
  }
  if (inDocs?.startsWith('assets/')) {
    return `/docs/${inDocs}${hash}`;
  }
  return `${REPOSITORY}/blob/v${version}/${resolved}${hash}`;
}

function frontMatter(source: string, file: string): { fields: { title: string; description: string }; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) {
    throw new Error(`${file} has no front matter. Start it with a title and a description between --- lines.`);
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const [, key, value] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
    if (key && value !== undefined) {
      fields[key] = value.startsWith('"') ? (JSON.parse(value) as string) : value;
    }
  }
  if (!fields.title || !fields.description) {
    throw new Error(`${file} needs a title and a description in its front matter.`);
  }
  return { fields: { title: fields.title, description: fields.description }, body: source.slice(match[0].length).replace(/^\n+/, '') };
}

/** Calls `visit` for each line, saying whether it is inside a fenced code block (fences included). */
function eachLine(markdown: string, visit: (line: string, inCode: boolean) => void): void {
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      visit(line, true);
      if (marker?.startsWith(fence)) {
        fence = undefined;
      }
    } else if (marker) {
      fence = marker;
      visit(line, true);
    } else {
      visit(line, false);
    }
  }
}

/** Applies `rewrite` to the Markdown outside code blocks and inline code. */
function mapProse(markdown: string, rewrite: (text: string) => string): string {
  const out: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length > 0) {
      out.push(
        prose
          .join('\n')
          .split(/(`[^`\n]*`)/)
          .map((part, i) => (i % 2 === 1 ? part : rewrite(part)))
          .join(''),
      );
      prose = [];
    }
  };
  eachLine(markdown, (line, inCode) => {
    if (inCode) {
      flush();
      out.push(line);
    } else {
      prose.push(line);
    }
  });
  flush();
  return out.join('\n');
}

/** A heading's text as it reads: link text kept, code ticks and emphasis dropped. */
function inlineText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*)(.+?)\1/g, '$2')
    .trim();
}

/** A section's text for search: no Markdown syntax, no HTML, one line. */
function plainText(markdown: string): string {
  return markdown
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
    .replace(/^\s*(?:>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[`|]|\*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
