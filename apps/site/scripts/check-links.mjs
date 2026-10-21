#!/usr/bin/env node
/**
 * Checks every internal link and image in the built site (dist/): the file it points at
 * exists, and so does the `#anchor` on that page. Links to other sites are not fetched.
 * Run after `astro build`: `pnpm --filter @spooldoc/site check:links`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

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

const problems = [];
let checked = 0;

for (const page of pages) {
  const html = fs.readFileSync(path.join(dist, page), 'utf8');
  const pageUrl = new URL(`https://spooldoc.com/${page.replace(/index\.html$/, '')}`);
  // Attributes of real tags only: a tag shown as code is escaped (`&#x3C;img src=...>`).
  const attributes = [...html.matchAll(/<[a-zA-Z][^<>]*>/g)].flatMap(([tag]) => [...tag.matchAll(/\s(href|src)="([^"]*)"/g)]);
  for (const [, attribute, value] of attributes) {
    if (!value || (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("https://spooldoc.com"))) continue;
    const target = new URL(value.replaceAll('&amp;', '&'), pageUrl);
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
  console.error(`${problems.length} broken ${problems.length === 1 ? 'link' : 'links'} in dist/:\n${problems.map((line) => `- ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(`Checked ${checked} internal links and images on ${pages.length} pages. All resolve.`);
