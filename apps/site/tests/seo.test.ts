import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsIndex, docsNav, docsPage, docsSlugs } from '../src/lib/docs';
import { absoluteDocsMarkdown, docsMarkdown } from '../src/lib/docsMarkdown';
import { gitFileDate, postDates, sitemapLastmod, type LastmodSources } from '../src/lib/lastmod';
import { docsMarkdownUrl } from '../src/lib/links';
import { llmsFullTxt, llmsTxt } from '../src/lib/llms';
import { docsJsonLd, HOME_TITLE } from '../src/lib/structuredData';

const site = new URL('https://spooldoc.com');

describe('guides as Markdown', () => {
  it('make links and images on the site absolute', () => {
    const markdown = [
      'See [Jobs](/docs/jobs#versions), [the docs](/docs) and [below](#masking).',
      '![Home](/docs/assets/home-light.png) and [GitHub](https://github.com/Strom-Capital/spooldoc).',
      '<a href="/docs/agent">Agent</a>',
    ].join('\n');
    expect(absoluteDocsMarkdown(markdown, site, '/docs/agent/')).toBe(
      [
        'See [Jobs](https://spooldoc.com/docs/jobs/#versions), [the docs](https://spooldoc.com/docs/) and [below](https://spooldoc.com/docs/agent/#masking).',
        '![Home](https://spooldoc.com/docs/assets/home-light.png) and [GitHub](https://github.com/Strom-Capital/spooldoc).',
        '<a href="https://spooldoc.com/docs/agent/">Agent</a>',
      ].join('\n'),
    );
  });

  it('turn a light and dark screenshot pair into one image', () => {
    const pair =
      '<p align="center"><img data-theme-image="light" src="/docs/assets/jobs-light.png" alt="The Jobs page" width="900" height="500"><img data-theme-image="dark" src="/docs/assets/jobs-dark.png" alt="The Jobs page" width="900" height="500"></p>';
    expect(absoluteDocsMarkdown(pair, site, '/docs/jobs/')).toBe('![The Jobs page](https://spooldoc.com/docs/assets/jobs-light.png)');
  });

  it('leave code blocks alone', () => {
    const markdown = '```html\n<img src="/logo.png">\n[a](/docs/jobs)\n```\n[a](/docs/jobs)';
    expect(absoluteDocsMarkdown(markdown, site, '/docs/jobs/')).toBe('```html\n<img src="/logo.png">\n[a](/docs/jobs)\n```\n[a](https://spooldoc.com/docs/jobs/)');
  });

  it('start with the title, the description and the page', () => {
    const text = docsMarkdown({ title: 'Jobs', description: 'The job builder.', slug: 'jobs', markdown: 'Body.\n', site });
    expect(text).toBe('# Jobs\n\n> The job builder.\n\nSource: https://spooldoc.com/docs/jobs/\n\nBody.\n');
  });

  it('leave no link on the site relative, in any guide', () => {
    const pages = [...docsSlugs().map((slug) => docsPage(slug)), { ...docsIndex(), slug: undefined, description: '' }];
    for (const page of pages) {
      const text = docsMarkdown({ ...page, site });
      expect(text, page.slug).not.toMatch(/\]\((?:\/|#)/);
      expect(text, page.slug).not.toContain('data-theme-image');
    }
  });

  it('are served next to the pages', () => {
    expect(docsMarkdownUrl('jobs')).toBe('/docs/jobs.md');
    expect(docsMarkdownUrl()).toBe('/docs/index.md');
  });
});

describe('llms-full.txt', () => {
  const pages = docsNav().flatMap(({ pages }) => pages.map(({ slug }) => docsPage(slug)));
  const text = llmsFullTxt({ site, pages, version: '1.2.3' });

  it('starts with the summary of llms.txt', () => {
    expect(text).toMatch(/^# Spooldoc\n\n> Spooled files into documents, for IBM i\./);
    expect(text).toContain('Latest release: 1.2.3');
  });

  it('holds every guide in the order of the sidebar', () => {
    const sources = [...text.matchAll(/^Source: (\S+)$/gm)].map((match) => match[1]);
    expect(sources).toEqual(docsSlugs().map((slug) => `https://spooldoc.com/docs/${slug}/`));
    for (const page of pages) expect(text).toContain(`\n# ${page.title}\n\n> ${page.description}\n`);
  });

  it('is linked from llms.txt, with each guide as Markdown', () => {
    const summary = llmsTxt({ site, nav: docsNav(), posts: [], version: '1.2.3' });
    expect(summary).toContain('(https://spooldoc.com/llms-full.txt)');
    expect(summary).toContain('(https://spooldoc.com/docs/index.md)');
    for (const slug of docsSlugs()) expect(summary, slug).toContain(`(https://spooldoc.com/docs/${slug}.md)`);
  });
});

describe('docs structured data', () => {
  it('describes a guide and its breadcrumb', () => {
    const data = docsJsonLd({ site, slug: 'jobs', title: 'Jobs', description: 'The job builder.', dateModified: new Date('2026-10-21T08:00:00Z') });
    const [article, breadcrumb] = data['@graph'] as Record<string, unknown>[];
    expect(article).toMatchObject({
      '@type': 'TechArticle',
      url: 'https://spooldoc.com/docs/jobs/',
      headline: 'Jobs',
      description: 'The job builder.',
      dateModified: '2026-10-21T08:00:00.000Z',
      inLanguage: 'en',
      author: { '@type': 'Organization', name: 'Ström Capital Oy' },
      isPartOf: { url: 'https://spooldoc.com/docs/' },
    });
    expect(breadcrumb).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { position: 1, name: 'Docs', item: 'https://spooldoc.com/docs/' },
        { position: 2, name: 'Jobs', item: 'https://spooldoc.com/docs/jobs/' },
      ],
    });
  });

  it('gives /docs no breadcrumb, and no date when git has none', () => {
    const data = docsJsonLd({ site, title: 'Documentation', description: 'The guides.' });
    const graph = data['@graph'] as Record<string, unknown>[];
    expect(graph).toHaveLength(1);
    expect(graph[0]?.url).toBe('https://spooldoc.com/docs/');
    expect(JSON.parse(JSON.stringify(data))['@graph'][0]).not.toHaveProperty('dateModified');
  });
});

describe('sitemap lastmod', () => {
  const day = (iso: string) => new Date(iso);
  const files: Record<string, Date> = {
    'docs/README.md': day('2026-10-01T00:00:00Z'),
    'docs/jobs.md': day('2026-10-02T00:00:00Z'),
    'apps/site/src/pages/index.astro': day('2026-10-03T00:00:00Z'),
    'apps/site/src/lib/features.ts': day('2026-10-04T00:00:00Z'),
    'CHANGELOG.md': day('2026-10-05T00:00:00Z'),
  };
  const sources: LastmodSources = {
    fileDate: (file) => files[file],
    posts: new Map([
      ['spooldoc-0-1-0', day('2026-10-19')],
      ['spooldoc-0-3-0', day('2026-10-21')],
    ]),
  };

  it('dates a guide by the last commit to its file', () => {
    expect(sitemapLastmod('/docs/', sources)).toEqual(files['docs/README.md']);
    expect(sitemapLastmod('/docs/jobs/', sources)).toEqual(files['docs/jobs.md']);
  });

  it('dates a post by its date, and the blog by the newest post', () => {
    expect(sitemapLastmod('/blog/spooldoc-0-1-0/', sources)).toEqual(day('2026-10-19'));
    expect(sitemapLastmod('/blog/', sources)).toEqual(day('2026-10-21'));
  });

  it('dates another page by the newest of its files', () => {
    expect(sitemapLastmod('/', sources)).toEqual(files['apps/site/src/lib/features.ts']);
    expect(sitemapLastmod('/changelog/', sources)).toEqual(files['CHANGELOG.md']);
  });

  it('gives no date where there is no honest one', () => {
    const none: LastmodSources = { fileDate: () => undefined, posts: new Map() };
    expect(sitemapLastmod('/docs/jobs/', none)).toBeUndefined();
    expect(sitemapLastmod('/blog/', none)).toBeUndefined();
    expect(sitemapLastmod('/features/', none)).toBeUndefined();
    expect(sitemapLastmod('/somewhere-else/', sources)).toBeUndefined();
  });

  it('reads the posts and their dates, without drafts', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'posts-'));
    fs.writeFileSync(path.join(folder, '2026-10-21-spooldoc-0-3-0.md'), '---\ntitle: "A"\ndate: 2026-10-21\n---\n\nText.\n');
    fs.writeFileSync(path.join(folder, '2026-10-22-later.md'), '---\ntitle: "B"\ndate: 2026-10-22\ndraft: true\n---\n');
    expect(postDates(folder)).toEqual(new Map([['spooldoc-0-3-0', day('2026-10-21')]]));
    fs.rmSync(folder, { recursive: true });
  });

  it('gives no date for a file outside git', () => {
    expect(gitFileDate(os.tmpdir(), 'not-a-file.md')).toBeUndefined();
  });
});

describe('home page', () => {
  it('has a title people search with, short enough to show in full', () => {
    expect(HOME_TITLE).toBe('Spooldoc: IBM i spool files to PDF, Word and Excel');
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60);
  });
});
