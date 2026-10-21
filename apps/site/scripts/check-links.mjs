#!/usr/bin/env node
/**
 * Checks every internal link and image in the built site (dist/): the file it points at
 * exists, and so does the `#anchor` on that page. Links to other sites are not fetched.
 * It also finds a word glued to a link or inline code, which the HTML compression makes
 * of a line break before the tag.
 * Run after `astro build`: `pnpm --filter @spooldoc/site check:links`, or
 * `node scripts/check-links.mjs <folder>` for another folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The built site, or another folder given as the first argument.
const dist = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../dist/', import.meta.url));

if (!fs.existsSync(dist)) {
  console.error('There is no dist/ folder. Run `pnpm --filter @spooldoc/site build` first.');
  process.exit(1);
}

/** Every file under `dir`, as paths relative to dist/ with forward slashes. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [path.relative(dist, full).split(path.sep).join('/')];
  });
}

const files = new Set(walk(dist));
const pages = [...files].filter((file) => file.endsWith('.html'));
const ids = new Map();

function idsOf(file) {
  if (!ids.has(file)) {
    const html = fs.readFileSync(path.join(dist, file), 'utf8');
    ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])));
  }
  return ids.get(file);
}

/** The file a site path is served from, as GitHub Pages resolves it. */
function resolve(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\//, '');
  for (const candidate of [clean, `${clean}index.html`, `${clean}/index.html`, `${clean}.html`]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/** Where the code blocks, scripts and styles of a page start and end, as [start, end) offsets. */
function blocks(html) {
  const ranges = [];
  for (const name of ['pre', 'script', 'style']) {
    const open = new RegExp(`<${name}\\b`, 'g');
    for (const match of html.matchAll(open)) {
      const close = html.indexOf(`</${name}>`, match.index);
      ranges.push([match.index, close === -1 ? html.length : close + name.length + 3]);
    }
  }
  return ranges;
}

const problems = [];
let checked = 0;

for (const page of pages) {
  const html = fs.readFileSync(path.join(dist, page), 'utf8');
  const pageUrl = new URL(`https://spooldoc.com/${page.replace(/index\.html$/, '')}`);
  // A word glued to an inline element, such as "therelease notes": Astro's HTML compression
  // drops a line break in the source between a word and a tag. Code blocks are left out.
  const skipped = blocks(html);
  for (const match of html.matchAll(/[A-Za-z,]<(?:a|code|strong|em)[ >]/g)) {
    if (skipped.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const glued = match[0];
    problems.push(`${page}: a word runs into an inline element at "${glued}". Keep the space before the tag on the same line, or write {' '}.`);
  }

  // Attributes of real tags only: a tag shown as code is escaped (`&#x3C;img src=...>`).
  const attributes = [...html.matchAll(/<[a-zA-Z][^<>]*>/g)].flatMap(([tag]) => [...tag.matchAll(/\s(href|src)="([^"]*)"/g)]);
  for (const [, attribute, value] of attributes) {
    if (!value) continue;
    let target;
    try {
      target = new URL(value.replaceAll('&amp;', '&'), pageUrl);
    } catch {
      continue;
    }
    // Other sites, and mailto: or data: links (origin "null"), are not checked.
    if (target.origin !== pageUrl.origin) continue;
    checked++;
    const file = resolve(target.pathname);
    if (!file) {
      problems.push(`${page}: ${attribute}="${value}" points at nothing`);
      continue;
    }
    const anchor = target.hash.slice(1);
    if (anchor && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(anchor))) {
      problems.push(`${page}: ${attribute}="${value}" has no #${anchor} on ${file}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} in dist/:\n${problems.map((line) => `- ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(`Checked ${checked} internal links and images on ${pages.length} pages. All resolve.`);
