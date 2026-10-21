import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { docsHeadings, docsHref, docsImageSize, docsNav, docsPage, docsSections, rewriteDocsMarkdown } from '../src/index.js';
import type { DocsOptions } from '../src/index.js';

const folder = fileURLToPath(new URL('../../../docs', import.meta.url));
const options: DocsOptions = { folder, repository: 'https://github.com/Strom-Capital/spooldoc', version: '1.2.3' };

const files = fs.readdirSync(folder).filter((file) => file.endsWith('.md') && file !== 'README.md');
const slugs = files.map((file) => file.slice(0, -'.md'.length));
const source = (file: string) => fs.readFileSync(path.join(folder, file), 'utf8');

/** Every Markdown link in a file, outside code, with its line. */
function links(file: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = [];
  let inCode = false;
  source(file)
    .split('\n')
    .forEach((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) {
        inCode = !inCode;
        return;
      }
      if (inCode) {
        return;
      }
      for (const match of text.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)|(?:src|srcset)="([^"]+)"/g)) {
        found.push({ target: (match[1] ?? match[2])!, line: i + 1 });
      }
    });
  return found;
}

describe('docs', () => {
  it('lists every page in exactly one README group, and only pages that exist', () => {
    const listed = docsNav(options).flatMap(({ pages }) => pages.map(({ slug }) => slug));
    expect([...listed].sort()).toEqual([...slugs].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(docsNav(options).map(({ group }) => group)).toEqual(['Get started', 'Use Spooldoc', 'Run Spooldoc', 'Develop']);
  });

  it('gives every page a title and a description, and names it in README as its title', () => {
    for (const { pages } of docsNav(options)) {
      for (const page of pages) {
        const full = docsPage(page.slug, options);
        expect(full.title, page.slug).toBeTruthy();
        expect(full.description, page.slug).toBeTruthy();
        expect(page.title, page.slug).toBe(full.title);
      }
    }
  });

  it('has a working target for every link between guides, assets and anchors', () => {
    const broken: string[] = [];
    for (const file of [...files, 'README.md']) {
      for (const { target, line } of links(file)) {
        if (/^[a-z]+:/i.test(target)) {
          continue;
        }
        const [name = '', anchor] = target.split('#');
        const where = `${file}:${line} ${target}`;
        if (name.startsWith('../')) {
          if (!fs.existsSync(path.join(folder, name))) {
            broken.push(where);
          }
          continue;
        }
        if (name && !name.endsWith('.md')) {
          if (!fs.existsSync(path.join(folder, name))) {
            broken.push(where);
          }
          continue;
        }
        const linked = name || file;
        if (!fs.existsSync(path.join(folder, linked))) {
          broken.push(where);
          continue;
        }
        if (anchor && !docsHeadings(source(linked)).some(({ id }) => id === anchor)) {
          broken.push(where);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('points the links from the app at headings that exist', () => {
    const ids = (slug: string) => docsPage(slug, options).headings.map(({ id }) => id);
    expect(ids('templates')).toEqual(expect.arrayContaining(['the-data', 'tags-in-word', 'tags-in-excel']));
    expect(slugs).toEqual(expect.arrayContaining(['definitions', 'getting-started']));
  });

  it('rewrites links for the app', () => {
    expect(docsHref('jobs.md', options)).toBe('/docs/jobs');
    expect(docsHref('jobs.md#versions', options)).toBe('/docs/jobs#versions');
    expect(docsHref('README.md', options)).toBe('/docs');
    expect(docsHref('#top', options)).toBe('#top');
    expect(docsHref('assets/home-light.png', options)).toBe('/docs/assets/home-light.png');
    expect(docsHref('../README.md#status', options)).toBe('https://github.com/Strom-Capital/spooldoc/blob/v1.2.3/README.md#status');
    expect(docsHref('../demo-spool/README.md', options)).toBe('https://github.com/Strom-Capital/spooldoc/blob/v1.2.3/demo-spool/README.md');
    expect(docsHref('https://ibmi.example.com/a.md', options)).toBe('https://ibmi.example.com/a.md');
    expect(rewriteDocsMarkdown('See [Jobs](jobs.md#versions), not `[x](y.md)`.\n\n```md\n[a](b.md)\n```', options)).toBe(
      'See [Jobs](/docs/jobs#versions), not `[x](y.md)`.\n\n```md\n[a](b.md)\n```',
    );
  });

  it('turns a light and dark picture into two images that follow the theme', () => {
    const picture = [
      '<p align="center">',
      '  <picture>',
      '    <source media="(prefers-color-scheme: dark)" srcset="assets/home-dark.png">',
      '    <img src="assets/home-light.png" alt="The Home page" width="900">',
      '  </picture>',
      '</p>',
    ].join('\n');
    expect(rewriteDocsMarkdown(picture, options)).toBe(
      '<p align="center"><img data-theme-image="light" src="/docs/assets/home-light.png" alt="The Home page" width="900" height="563">' +
        '<img data-theme-image="dark" src="/docs/assets/home-dark.png" alt="The Home page" width="900" height="563"></p>',
    );
    for (const slug of slugs) {
      expect(docsPage(slug, options).markdown, slug).not.toContain('<picture');
    }
  });

  it('gives every image its size, so anchors land before the images load', () => {
    expect(docsImageSize('assets/home-light.png', options)).toEqual({ width: 2880, height: 1800 });
    expect(docsImageSize('assets/home-light.png', options, 900)).toEqual({ width: 900, height: 563 });
    expect(docsImageSize('assets/architecture-light.svg', options)).toEqual({ width: 1200, height: 740 });
    for (const slug of slugs) {
      for (const [image] of docsPage(slug, options).markdown.matchAll(/<img\b[^>]*src="\/docs\/assets\/[^>]*>/g)) {
        expect(image, slug).toMatch(/ width="\d+" height="\d+"/);
      }
    }
  });

  it('counts repeated headings as GitHub does', () => {
    expect(docsHeadings('## Fields\n\n```\n## not a heading\n```\n\n### `MYLIB` and [jobs](jobs.md)\n\n## Fields').map(({ id }) => id)).toEqual([
      'fields',
      'mylib-and-jobs',
      'fields-1',
    ]);
  });

  it('cuts every page into sections with text for search', () => {
    const sections = docsSections(options);
    for (const slug of slugs) {
      const own = sections.filter((section) => section.page === slug);
      expect(own.length, slug).toBeGreaterThan(0);
      expect(own.some((section) => section.text.length > 0), slug).toBe(true);
      for (const section of own.filter((section) => section.anchor)) {
        expect(docsPage(slug, options).headings.map(({ id }) => id)).toContain(section.anchor);
      }
    }
    const tags = sections.find((section) => section.page === 'templates' && section.anchor === 'tags-in-word');
    expect(tags?.heading).toBe('Tags in Word');
    expect(tags?.text).not.toMatch(/\]\(|<\w/);
  });

  it('reads long hostile text in linear time', () => {
    const hostile = [
      '['.repeat(50000),
      '[]('.repeat(50000),
      '](]('.repeat(50000),
      '<'.repeat(50000),
      '\n'.repeat(50000) + 'x',
      `| ${' '.repeat(50000)}x`,
      `- ${'\n'.repeat(50000)}x`,
      `a: ${' '.repeat(50000)}\r`,
    ];
    const started = performance.now();
    expect(docsHeadings('# a' + ' '.repeat(50000) + 'b')).toEqual([{ depth: 1, text: 'a' + ' '.repeat(50000) + 'b', id: expect.any(String) }]);
    expect(docsHeadings('# a' + ' '.repeat(50000) + '#'.repeat(50000) + ' '.repeat(50000))[0]?.text).toBe('a');
    expect(docsHeadings('# ' + '['.repeat(50000))).toHaveLength(1);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spooldoc-docs-'));
    try {
      fs.writeFileSync(path.join(temp, 'README.md'), '## Group\n\n| [Page](page.md) | A page |\n');
      fs.writeFileSync(path.join(temp, 'page.md'), `---\ntitle: Page\ndescription: A page\n---\n\n${hostile.join('\n\n')}\n`);
      const local: DocsOptions = { ...options, folder: temp };
      expect(docsSections(local).length).toBeGreaterThan(0);
      for (const text of hostile) {
        rewriteDocsMarkdown(text, local);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
