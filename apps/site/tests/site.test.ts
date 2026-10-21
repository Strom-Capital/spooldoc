import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineSvg } from '../src/lib/brand';
import { docsAssets, docsNav, docsSlugs } from '../src/lib/docs';
import { parseDefinition } from '@spooldoc/core';
import { DEFINITION_EXAMPLE, FEATURES, SHOTS } from '../src/lib/features';
import { docsUrl, formatDate, links, url } from '../src/lib/links';
import { llmsTxt } from '../src/lib/llms';
import { sortPosts, type PostLike } from '../src/lib/sortPosts';
import { OVERVIEW_VIDEO, vttCues } from '../src/lib/video';
import { FEATURES_DESCRIPTION, HOME_TITLE, homeJsonLd, postJsonLd, serializeJsonLd } from '../src/lib/structuredData';

const site = new URL('https://spooldoc.com');
const post: PostLike = {
  id: 'spooldoc-1-2-3',
  data: {
    title: 'A post',
    description: 'What it says.',
    date: new Date('2026-10-21'),
    tags: ['release'],
    originalUrl: 'https://github.com/Strom-Capital/spooldoc/discussions/1',
  },
};

describe('links', () => {
  it('builds paths on the site', () => {
    expect(url('/blog/')).toBe('/blog/');
    expect(url('features/')).toBe('/features/');
  });

  it('links to guides with the trailing slash', () => {
    expect(docsUrl()).toBe('/docs/');
    expect(docsUrl('jobs')).toBe('/docs/jobs/');
    expect(docsUrl('jobs', 'versions')).toBe('/docs/jobs/#versions');
  });

  it('formats dates in UTC', () => {
    expect(formatDate(new Date('2026-10-21T00:00:00Z'))).toBe('21 October 2026');
  });
});

describe('posts', () => {
  it('sorts the newest first', () => {
    const older = { ...post, id: 'older', data: { ...post.data, date: new Date('2026-01-01') } };
    expect(sortPosts([older, post]).map((p) => p.id)).toEqual(['spooldoc-1-2-3', 'older']);
  });

  it('puts two posts of one day in file name order, newest first', () => {
    const day = new Date('2026-10-19');
    const a = { id: 'spooldoc-0-1-0', filePath: 'src/content/blog/2026-10-19-spooldoc-0-1-0.md', data: { ...post.data, date: day } };
    const b = { id: 'spooldoc-0-2-0', filePath: 'src/content/blog/2026-10-19-spooldoc-0-2-0.md', data: { ...post.data, date: day } };
    expect(sortPosts([a, b]).map((p) => p.id)).toEqual(['spooldoc-0-2-0', 'spooldoc-0-1-0']);
  });
});

describe('blog posts', () => {
  const folder = path.join(process.cwd(), 'src/content/blog');
  const files = fs.readdirSync(folder).filter((file) => file.endsWith('.md'));
  const read = (file: string) => fs.readFileSync(path.join(folder, file), 'utf8');

  it('are named by the date in their header', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const day = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/.exec(file)?.[1];
      expect(day, file).toBeDefined();
      expect(read(file), file).toMatch(new RegExp(`^date: ${day}$`, 'm'));
    }
  });

  it('link a release post to its release and its announcement', () => {
    const releases = files.filter((file) => /^tags: \[.*\brelease\b.*\]$/m.test(read(file)));
    expect(releases.length).toBeGreaterThan(0);
    for (const file of releases) {
      const text = read(file);
      const version = /^title: "Spooldoc (\d+\.\d+\.\d+)/m.exec(text)?.[1];
      expect(version, file).toBeDefined();
      expect(text, file).toContain(`https://github.com/Strom-Capital/spooldoc/releases/tag/v${version}`);
      expect(text, file).toMatch(/^originalUrl: "https:\/\/github\.com\/Strom-Capital\/spooldoc\/discussions\/\d+"$/m);
    }
  });

  it('show no tags on the pages: tags are for the JSON-LD only', () => {
    for (const file of sources(path.join(process.cwd(), 'src')).filter((name) => name.endsWith('.astro'))) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/data\.tags/);
    }
  });

  it('use no images hosted on GitHub', () => {
    for (const file of files) {
      expect(read(file), file).not.toMatch(/user-attachments|githubusercontent/);
    }
  });
});

describe('structured data', () => {
  it('describes the software on the home page', () => {
    const data = homeJsonLd(site, '1.2.3');
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.name).toBe('Spooldoc');
    expect(data.license).toBe('https://opensource.org/licenses/MIT');
    expect(data.codeRepository).toBe(links.github);
    expect(data.softwareVersion).toBe('1.2.3');
    expect(data.description).toEqual(expect.any(String));
  });

  it('describes a post', () => {
    const data = postJsonLd(post, site);
    expect(data['@type']).toBe('BlogPosting');
    expect(data.url).toBe('https://spooldoc.com/blog/spooldoc-1-2-3/');
    expect(data.headline).toBe('A post');
    expect(data.datePublished).toBe('2026-10-21T00:00:00.000Z');
    expect(data.keywords).toBe('release');
    expect(data.sameAs).toBe('https://github.com/Strom-Capital/spooldoc/discussions/1');
  });

  it('cannot close its script tag', () => {
    expect(serializeJsonLd({ name: '</script><script>' })).not.toContain('</script>');
  });
});

describe('llms.txt', () => {
  const text = llmsTxt({ site, nav: docsNav(), posts: [post], version: '1.2.3' });

  it('links to every guide', () => {
    for (const slug of docsSlugs()) {
      expect(text, slug).toContain(`(https://spooldoc.com/docs/${slug}/)`);
    }
  });

  it('links to the features, the docs, the blog and the changelog', () => {
    expect(text).toContain('(https://spooldoc.com/features/)');
    expect(text).toContain('(https://spooldoc.com/changelog/)');
    expect(text).not.toContain('rss');
    expect(text).toContain('(https://spooldoc.com/docs/)');
    expect(text).toContain('(https://spooldoc.com/blog/)');
    expect(text).toContain('(https://spooldoc.com/blog/spooldoc-1-2-3/)');
    for (const feature of FEATURES) {
      expect(text).toContain(`(https://spooldoc.com/features/#${feature.id})`);
    }
  });

  it('starts with the name and a summary', () => {
    expect(text).toMatch(/^# Spooldoc\n\n> Spooled files into documents, for IBM i\./);
    expect(text).toContain('Latest release: 1.2.3');
  });
});

describe('features', () => {
  it('have unique anchors', () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('show screenshots that exist, light and dark', () => {
    const assets = docsAssets();
    for (const feature of FEATURES) {
      expect(feature.shots.length, feature.id).toBeGreaterThan(0);
      expect(new Set(feature.shots).size, feature.id).toBe(feature.shots.length);
      for (const shot of feature.shots) {
        expect(assets, shot).toContain(`${shot}-light.png`);
        expect(assets, shot).toContain(`${shot}-dark.png`);
      }
    }
  });

  it('describe every screenshot in a full sentence', () => {
    const assets = docsAssets();
    for (const [name, alt] of Object.entries(SHOTS)) {
      expect(assets, name).toContain(`${name}-light.png`);
      expect(assets, name).toContain(`${name}-dark.png`);
      expect(alt, name).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('show a YAML sample the definition parser takes, the one in the screenshot', () => {
    const definition = parseDefinition(DEFINITION_EXAMPLE);
    expect(definition.type).toBe('sales-invoice');
    expect(definition.source).toBe('text');
  });

  it('keep code samples narrow enough for their place', () => {
    for (const feature of FEATURES) {
      if (!feature.code) continue;
      const longest = Math.max(...feature.code.code.split('\n').map((line) => line.length));
      // Beside the text the column holds about 60 characters of code at desktop width.
      if (feature.code.place === 'beside') expect(longest, feature.id).toBeLessThanOrEqual(60);
    }
  });

  it('link to guides that exist', () => {
    const slugs = docsSlugs();
    for (const feature of FEATURES) {
      expect(feature.docs.length).toBeGreaterThan(0);
      for (const doc of feature.docs) expect(slugs, doc.slug).toContain(doc.slug);
    }
  });
});

describe('overview video', () => {
  const folder = path.join(process.cwd(), 'public/video');
  const { name } = OVERVIEW_VIDEO;

  it('has a video and a poster for each theme, and captions', () => {
    for (const file of [`${name}-light.mp4`, `${name}-dark.mp4`, `${name}-light.jpg`, `${name}-dark.jpg`, `${name}.vtt`]) {
      expect(fs.existsSync(path.join(folder, file)), file).toBe(true);
    }
  });

  it('has a transcript with the words of the captions', () => {
    const cues = vttCues(fs.readFileSync(path.join(folder, `${name}.vtt`), 'utf8'));
    expect(cues.length).toBeGreaterThan(0);
    expect(OVERVIEW_VIDEO.transcript.join(' ')).toBe(cues.join(' '));
  });

  it('is on the home page, with its transcript', () => {
    const home = fs.readFileSync(path.join(process.cwd(), 'src/pages/index.astro'), 'utf8');
    expect(home).toContain('<SiteVideo name={OVERVIEW_VIDEO.name} label={OVERVIEW_VIDEO.label} />');
    expect(home).toContain('<summary>Transcript</summary>');
  });
});

describe('brand', () => {
  it('keeps the ids of two inline logos apart', () => {
    const svg = '<svg width="10" height="10" viewBox="0 0 10 10" role="img" aria-label="Logo"><mask id="m"/><path mask="url(#m)"/></svg>';
    const out = inlineSvg(svg, 'header-light', 'logo-light');
    expect(out).toBe('<svg viewBox="0 0 10 10" class="logo-light" aria-hidden="true" focusable="false"><mask id="header-light-m"/><path mask="url(#header-light-m)"/></svg>');
  });
});

/** Every source file the site's words live in. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(astro|ts|md)$/.test(entry.name) ? [full] : [];
  });
}

describe('site copy', () => {
  const files = sources(path.join(process.cwd(), 'src'));

  it('uses no middle dot and no em or en dash', () => {
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/[·–—]/);
    }
  });

  // The brand guide's banned words and claims we never make (sections 5.6 and 6.3).
  const banned =
    /\b(seamless(ly)?|revolutioni[sz]e|unlock|leverage|cutting-edge|next-gen|robust|effortless(ly)?|easy|easier|game-changer|powerful|empower|supercharge|turbocharge|magic(ally)?|intelligent|smart|solutions?|best-in-class|world-class|legacy|outdated|old-fashioned|finally|no more|out of the box|simply|obviously|enterprise-grade|production-ready|battle-tested|secure|compliant|free)\b/i;

  it('puts no label above a heading', () => {
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\beyebrow\b/);
    }
  });

  it('shows the version in the footer, linked to its entry in the changelog', () => {
    const base = fs.readFileSync(path.join(process.cwd(), 'src/layouts/Base.astro'), 'utf8');
    expect(base).toContain('href={url(`/changelog/#${releaseAnchor(version)}`)}>Version {version}</a>');
  });

  it('uses none of the banned words', () => {
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(banned);
    }
  });

  it('uses American spelling and the words of the app', () => {
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\b(colours?|licence|behaviour|organis(e|ed|ation)|favourite|centre|catalogue|analyse)\b/i);
      // The home page's title and the features page's description use the word people search with.
      expect(text.replace(HOME_TITLE, '').replace(FEATURES_DESCRIPTION, ''), file).not.toMatch(/\bspool files?\b/i);
      expect(text, file).not.toMatch(/\bconver(t|ts|ted|ting|sion)\b/i);
    }
  });

  it('calls the chat feature the agent', () => {
    for (const file of files) {
      // The screenshot's file name and the provider's product name stay as they are.
      const text = fs.readFileSync(file, 'utf8').replaceAll('ai-assistant', '').replaceAll('Vercel AI Gateway', '');
      expect(text, file).not.toMatch(/\bassistants?\b|\bcopilot\b|AI-(powered|driven)|\bthe AI\b/i);
      // "AI" is fine as a plain fact ("an AI model you choose"), at most twice in a file.
      expect(text.match(/\bAI\b/g)?.length ?? 0, file).toBeLessThanOrEqual(2);
    }
  });
});
