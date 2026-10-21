import fs from 'node:fs';
import path from 'node:path';
import { docsHeadings } from '@spooldoc/docs';
import { describe, expect, it } from 'vitest';
import { docsAssets, docsFolder, docsIndex, docsNav, docsPage, docsSections, docsSlugs, siteDocsHtml, siteVersion } from '../src/lib/docs';
import { renderMarkdown } from '../src/lib/markdown';

describe('docs routes', () => {
  it('has a page for every guide in docs/README.md, once each', () => {
    const slugs = docsSlugs();
    expect(slugs.length).toBeGreaterThan(10);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(fs.existsSync(path.join(docsFolder(), `${slug}.md`)), slug).toBe(true);
    }
  });

  it('lists every guide in docs/ in the sidebar', () => {
    const files = fs
      .readdirSync(docsFolder())
      .filter((file) => file.endsWith('.md') && file !== 'README.md')
      .map((file) => file.slice(0, -'.md'.length));
    expect(docsSlugs().sort()).toEqual(files.sort());
  });

  it('reads the version from the root package.json', () => {
    expect(siteVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('takes /docs from docs/README.md, without its # heading', () => {
    const index = docsIndex();
    expect(index.title).toBe('Documentation');
    expect(index.markdown).not.toMatch(/^# /m);
    expect(index.headings.map((heading) => heading.text)).toEqual(docsNav().map(({ group }) => group));
    expect(index.markdown).toContain('](/docs/getting-started)');
  });

  it('serves the screenshots of docs/assets, light and dark', () => {
    const assets = docsAssets();
    expect(assets).toContain('home-light.png');
    expect(assets).toContain('architecture-dark.svg');
    expect(assets.every((file) => !file.includes('/'))).toBe(true);
  });

  it('builds the search index from every guide', () => {
    const pages = new Set(docsSections().map((section) => section.page));
    expect([...pages].sort()).toEqual(docsSlugs().sort());
  });
});

describe('siteDocsHtml', () => {
  it('adds the trailing slash to links between guides', () => {
    expect(siteDocsHtml('<a href="/docs/jobs#versions">')).toBe('<a href="/docs/jobs/#versions">');
    expect(siteDocsHtml('<a href="/docs/jobs">')).toBe('<a href="/docs/jobs/">');
    expect(siteDocsHtml('<a href="/docs">')).toBe('<a href="/docs/">');
    expect(siteDocsHtml('<a href="/docs#use-spooldoc">')).toBe('<a href="/docs/#use-spooldoc">');
  });

  it('leaves images, files and other sites alone', () => {
    const html = '<img src="/docs/assets/home-light.png"><a href="/docs/assets/home-light.png"><a href="https://example.com/docs/jobs">';
    expect(siteDocsHtml(html)).toBe(html);
  });
});

describe('renderMarkdown', () => {
  it('gives each heading the id @spooldoc/docs and GitHub give it', async () => {
    for (const slug of docsSlugs()) {
      const page = docsPage(slug);
      const html = await renderMarkdown(page.markdown);
      const rendered = [...html.matchAll(/<h([1-6]) id="([^"]+)"/g)].map((match) => match[2]);
      expect(rendered, slug).toEqual(docsHeadings(page.markdown).map((heading) => heading.id));
    }
  });

  it('keeps the light and dark screenshots of a guide', async () => {
    const html = await renderMarkdown(docsPage('jobs').markdown);
    expect(html).toContain('data-theme-image="light" src="/docs/assets/jobs-light.png"');
    expect(html).toContain('data-theme-image="dark" src="/docs/assets/jobs-dark.png"');
  });

  it('puts each screenshot of a pair in its own link to its file, for the image viewer', async () => {
    const html = await renderMarkdown(docsPage('jobs').markdown);
    for (const theme of ['light', 'dark']) {
      const link = new RegExp(`<a href="/docs/assets/jobs-${theme}.png" data-zoom="" aria-label="Open the image full size: [^"]+" data-theme-image="${theme}"><img data-theme-image="${theme}" src="/docs/assets/jobs-${theme}.png"`);
      expect(html).toMatch(link);
    }
  });

  it('links every image in every guide to the image viewer', async () => {
    for (const slug of docsSlugs()) {
      const html = await renderMarkdown(docsPage(slug).markdown);
      const images = html.match(/<img\b/g)?.length ?? 0;
      const links = html.match(/<a [^>]*data-zoom=""[^>]*><img\b/g)?.length ?? 0;
      expect(links, slug).toBe(images);
    }
  });

  it('highlights code with both themes and leaves Mermaid as text', async () => {
    const html = await renderMarkdown('```yaml\ntype: invoice\n```\n\n```mermaid\nflowchart LR\n  a --> b\n```\n');
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(html).toContain('class="language-mermaid"');
  });

  it('keeps straight quotes and double hyphens, as the app does', async () => {
    const html = await renderMarkdown('Run "it" -- now...');
    expect(html).toContain('Run "it" -- now...');
  });

  it('links outside docs/ go to GitHub at the release tag', async () => {
    const html = await renderMarkdown(docsPage('getting-started').markdown);
    expect(html).toContain(`https://github.com/Strom-Capital/spooldoc/blob/v${siteVersion()}/demo-spool/README.md`);
  });
});
