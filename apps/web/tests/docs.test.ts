import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsFolder, docsHeadings, docsHref, docsImageSize, docsNav, docsPage, docsSections, rewriteDocsMarkdown } from '@/lib/server/docs';

const files = fs.readdirSync(docsFolder()).filter((file) => file.endsWith('.md') && file !== 'README.md');
const slugs = files.map((file) => file.slice(0, -'.md'.length));
const source = (file: string) => fs.readFileSync(path.join(docsFolder(), file), 'utf8');

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
    const listed = docsNav().flatMap(({ pages }) => pages.map(({ slug }) => slug));
    expect([...listed].sort()).toEqual([...slugs].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(docsNav().map(({ group }) => group)).toEqual(['Get started', 'Use Spooldoc', 'Run Spooldoc', 'Develop']);
  });

  it('gives every page a title and a description, and names it in README as its title', () => {
    for (const { pages } of docsNav()) {
      for (const page of pages) {
        const full = docsPage(page.slug);
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
          if (!fs.existsSync(path.join(docsFolder(), name))) {
            broken.push(where);
          }
          continue;
        }
        if (name && !name.endsWith('.md')) {
          if (!fs.existsSync(path.join(docsFolder(), name))) {
            broken.push(where);
          }
          continue;
        }
        const linked = name || file;
        if (!fs.existsSync(path.join(docsFolder(), linked))) {
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
    const ids = (slug: string) => docsPage(slug).headings.map(({ id }) => id);
    expect(ids('templates')).toEqual(expect.arrayContaining(['the-data', 'tags-in-word', 'tags-in-excel']));
    expect(slugs).toEqual(expect.arrayContaining(['definitions', 'getting-started']));
  });

  it('rewrites links for the app', () => {
    expect(docsHref('jobs.md', '1.2.3')).toBe('/docs/jobs');
    expect(docsHref('jobs.md#versions', '1.2.3')).toBe('/docs/jobs#versions');
    expect(docsHref('README.md', '1.2.3')).toBe('/docs');
    expect(docsHref('#top', '1.2.3')).toBe('#top');
    expect(docsHref('assets/home-light.png', '1.2.3')).toBe('/docs/assets/home-light.png');
    expect(docsHref('../README.md#status', '1.2.3')).toBe('https://github.com/Strom-Capital/spooldoc/blob/v1.2.3/README.md#status');
    expect(docsHref('../demo-spool/README.md', '1.2.3')).toBe('https://github.com/Strom-Capital/spooldoc/blob/v1.2.3/demo-spool/README.md');
    expect(docsHref('https://ibmi.example.com/a.md', '1.2.3')).toBe('https://ibmi.example.com/a.md');
    expect(rewriteDocsMarkdown('See [Jobs](jobs.md#versions), not `[x](y.md)`.\n\n```md\n[a](b.md)\n```', '1.2.3')).toBe(
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
    expect(rewriteDocsMarkdown(picture, '1.2.3')).toBe(
      '<p align="center"><img class="dark:hidden" src="/docs/assets/home-light.png" alt="The Home page" width="900" height="563">' +
        '<img class="hidden dark:inline" src="/docs/assets/home-dark.png" alt="The Home page" width="900" height="563"></p>',
    );
    for (const slug of slugs) {
      expect(docsPage(slug).markdown, slug).not.toContain('<picture');
    }
  });

  it('gives every image its size, so anchors land before the images load', () => {
    expect(docsImageSize('assets/home-light.png')).toEqual({ width: 2880, height: 1800 });
    expect(docsImageSize('assets/home-light.png', 900)).toEqual({ width: 900, height: 563 });
    expect(docsImageSize('assets/architecture-light.svg')).toEqual({ width: 1200, height: 660 });
    for (const slug of slugs) {
      for (const [image] of docsPage(slug).markdown.matchAll(/<img\b[^>]*src="\/docs\/assets\/[^>]*>/g)) {
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
    const sections = docsSections();
    for (const slug of slugs) {
      const own = sections.filter((section) => section.page === slug);
      expect(own.length, slug).toBeGreaterThan(0);
      expect(own.some((section) => section.text.length > 0), slug).toBe(true);
      for (const section of own.filter((section) => section.anchor)) {
        expect(docsPage(slug).headings.map(({ id }) => id)).toContain(section.anchor);
      }
    }
    const tags = sections.find((section) => section.page === 'templates' && section.anchor === 'tags-in-word');
    expect(tags?.heading).toBe('Tags in Word');
    expect(tags?.text).not.toMatch(/\]\(|<\w/);
  });
});
