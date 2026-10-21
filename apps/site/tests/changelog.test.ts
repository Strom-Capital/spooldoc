import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupTitle, parseChangelog, parseItem, readChangelog, releaseAnchor, releasePostId, type ChangelogItem } from '../src/lib/changelog';

/** An item's text as one string, with inline code in backticks. */
const plain = (item: ChangelogItem) => item.text.map((piece) => (piece.type === 'code' ? `\`${piece.text}\`` : piece.text)).join('');

describe('CHANGELOG.md', () => {
  const releases = readChangelog();
  const text = fs.readFileSync(path.resolve(process.cwd(), '../../CHANGELOG.md'), 'utf8');

  it('finds every release in the file', () => {
    const headings = text.split('\n').filter((line) => /^#{2,3} \[?v?\d+\.\d+\.\d+/.test(line));
    expect(headings.length).toBeGreaterThan(0);
    expect(releases).toHaveLength(headings.length);
    expect(releases.map((release) => release.version)).toContain('0.1.0');
  });

  it('reads the dates, newest first', () => {
    for (const release of releases) expect(Number.isNaN(release.date.getTime()), release.version).toBe(false);
    const times = releases.map((release) => release.date.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('gives every release items, a link to GitHub and an anchor', () => {
    for (const release of releases) {
      expect(release.groups.flatMap((group) => group.items).length, release.version).toBeGreaterThan(0);
      expect(release.releaseUrl).toBe(`https://github.com/Strom-Capital/spooldoc/releases/tag/v${release.version}`);
      expect(release.anchor).toBe(release.version.replaceAll('.', '-'));
    }
  });

  it('drops the scopes and the commit links, and keeps the pull requests', () => {
    const items = releases.flatMap((release) => release.groups.flatMap((group) => group.items));
    for (const item of items) {
      const words = plain(item);
      expect(words, words).not.toMatch(/\*\*[\w-]+:\*\*/);
      expect(words, words).not.toMatch(/\/commit\/|\[[0-9a-f]{7}\]/);
      expect(words, words).not.toMatch(/\[#\d+\]/);
      expect(words.charAt(0), words).toBe(words.charAt(0).toUpperCase());
    }
    expect(items.some((item) => item.pr === 93)).toBe(true);
    expect(items.some((item) => item.closes.includes(46))).toBe(true);
  });

  it('has the breaking changes of 0.3.0 first, in full', () => {
    const release = releases.find((entry) => entry.version === '0.3.0')!;
    const breaking = release.groups[0]!;
    expect(breaking.title).toBe('Breaking changes');
    expect(breaking.breaking).toBe(true);
    expect(breaking.items.length).toBeGreaterThanOrEqual(2);
    expect(breaking.items.map(plain).join(' ')).toContain('{d.pg.invoiceNo}');
    expect(release.groups.map((group) => group.title)).toEqual(['Breaking changes', 'Features', 'Bug fixes']);
  });

  it('finds the release posts by their slugs', () => {
    const posts = fs.readdirSync(path.join(process.cwd(), 'src/content/blog')).map((file) => file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
    expect(posts).toContain(releasePostId('0.3.0'));
  });
});

describe('the changelog parser', () => {
  const releases = parseChangelog(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/CHANGELOG.md'), 'utf8'));

  it('reads every heading form', () => {
    expect(releases.map((release) => release.version)).toEqual(['2.0.0', '1.1.1', '1.0.0']);
    expect(releases[0]!.compareUrl).toBe('https://github.com/Strom-Capital/spooldoc/compare/v1.1.1...v2.0.0');
    expect(releases[1]!.date.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(releases[2]!.compareUrl).toBeUndefined();
    expect(releases[2]!.date.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('names the groups in sentence case, breaking changes first', () => {
    expect(releases[0]!.groups.map((group) => group.title)).toEqual(['Breaking changes', 'Features', 'Performance improvements', 'Reverts']);
    expect(releases[2]!.groups.map((group) => group.title)).toEqual(['Miscellaneous chores']);
    expect(groupTitle('⚠ BREAKING CHANGES')).toBe('Breaking changes');
    expect(groupTitle('Bug Fixes')).toBe('Bug fixes');
  });

  it('keeps a breaking change over two lines, with its inline code', () => {
    const item = releases[0]!.groups[0]!.items[0]!;
    expect(plain(item)).toBe('Templates read `{d.pg.invoiceNo}` in place of {d.doc.invoiceNo}. Rename them in any copies you keep elsewhere.');
    expect(item.text[1]).toEqual({ type: 'code', text: '{d.pg.invoiceNo}' });
  });

  it('reads an item: scope and commit dropped, pull request kept, first letter capitalized', () => {
    const item = releases[0]!.groups[1]!.items[0]!;
    expect(plain(item)).toBe('A queue page for MYOUTQ');
    expect(item.pr).toBe(12);
    expect(item.closes).toEqual([]);
    expect(releases[1]!.groups[0]!.items[0]!.pr).toBe(8);
  });

  it('keeps the issues an item closes', () => {
    const item = releases[0]!.groups[2]!.items[0]!;
    expect(plain(item)).toBe('Faster page reads');
    expect(item.pr).toBe(9);
    expect(item.closes).toEqual([7]);
    const revert = releases[0]!.groups[3]!.items[0]!;
    expect(plain(revert)).toBe('"feat: a test"');
    expect(revert.closes).toEqual([3, 4]);
    expect(revert.pr).toBeUndefined();
  });

  it('reads an item that closes an issue in its title', () => {
    const item = parseItem('render every format with Carbone (closes [#46](https://github.com/Strom-Capital/spooldoc/issues/46)) ([#50](https://github.com/Strom-Capital/spooldoc/issues/50)) ([3ac675a](https://github.com/Strom-Capital/spooldoc/commit/3ac675a2e40fd9daf1ca65e3fc5149480d71bfe4))');
    expect(plain(item)).toBe('Render every format with Carbone');
    expect(item.pr).toBe(50);
    expect(item.closes).toEqual([46]);
  });

  it('reads a file with no releases as none', () => {
    expect(parseChangelog('# Changelog\n')).toEqual([]);
  });

  it('makes anchors and post slugs from versions', () => {
    expect(releaseAnchor('0.3.0')).toBe('0-3-0');
    expect(releasePostId('0.3.0')).toBe('spooldoc-0-3-0');
  });
});
