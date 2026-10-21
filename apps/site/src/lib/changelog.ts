import fs from 'node:fs';
import path from 'node:path';
import { GITHUB } from './links';

/**
 * The releases in CHANGELOG.md at the repository root, which Release Please writes, read
 * at build time for /changelog. The shape it writes:
 *
 *   ## [0.3.0](https://github.com/.../compare/v0.2.0...v0.3.0) (2026-10-21)
 *   ## 0.1.0 (2026-10-18)                      the first release, with no compare link
 *   ### ⚠ BREAKING CHANGES, ### Features, ### Bug Fixes, ### Reverts, ...
 *   * **web:** title ([#93](.../issues/93)) ([d1c7a94](.../commit/d1c7a94...))
 *   * title (closes [#46](.../issues/46)) ([#50](.../issues/50)) ([3ac675a](.../commit/...))
 *
 * Each item keeps its title, capitalized and without the scope, its pull request and the
 * issues it closes. The commit link is dropped.
 */

/** A piece of an item's text: plain text, inline code, bold text or a link. */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string };

export interface ChangelogItem {
  /** The title, or the full text of a breaking change, as inline pieces. */
  text: Inline[];
  /** The pull request number, linked as `/pull/N`. */
  pr?: number;
  /** The issues the change closes. */
  closes: number[];
}

export interface ChangelogGroup {
  /** In sentence case: "Breaking changes", "Features", "Bug fixes". */
  title: string;
  breaking: boolean;
  items: ChangelogItem[];
}

export interface Release {
  /** 0.3.0, without a `v`. */
  version: string;
  /** The heading's id on /changelog: 0-3-0. */
  anchor: string;
  /** The release day, at midnight UTC. */
  date: Date;
  /** The compare link of the heading; none for the first release. */
  compareUrl?: string;
  /** The release on GitHub. */
  releaseUrl: string;
  /** Breaking changes first, then the groups in the order of the file. */
  groups: ChangelogGroup[];
}

const RELEASE = /^#{2,3}\s+(?:\[v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]\(([^)\s]+)\)|v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?))\s+\((\d{4}-\d{2}-\d{2})\)\s*$/;
const GROUP = /^###\s+(.+?)\s*$/;
const BULLET = /^[*-]\s+(.*)$/;

/** The id of a release's heading: 0.3.0 is 0-3-0. */
export function releaseAnchor(version: string): string {
  return version.replace(/[^0-9A-Za-z-]/g, '-');
}

/** The slug of a release's blog post: 0.3.0 is spooldoc-0-3-0. */
export function releasePostId(version: string): string {
  return `spooldoc-${releaseAnchor(version)}`;
}

/** "⚠ BREAKING CHANGES" is "Breaking changes", "Bug Fixes" is "Bug fixes". */
export function groupTitle(heading: string): string {
  const words = heading.replace(/^[^A-Za-z]+/, '').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Parses the text of CHANGELOG.md. Releases come out newest first, as in the file. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let group: ChangelogGroup | undefined;
  let item: { raw: string } | undefined;
  const raws = new Map<ChangelogGroup, { raw: string }[]>();

  for (const line of markdown.split(/\r?\n/)) {
    const release = RELEASE.exec(line);
    if (release) {
      const version = (release[1] ?? release[3])!;
      releases.push({
        version,
        anchor: releaseAnchor(version),
        date: new Date(`${release[4]}T00:00:00Z`),
        compareUrl: release[2],
        releaseUrl: `${GITHUB}/releases/tag/v${version}`,
        groups: [],
      });
      group = undefined;
      item = undefined;
      continue;
    }
    const current = releases.at(-1);
    if (!current) continue;

    const heading = GROUP.exec(line);
    if (heading) {
      const title = groupTitle(heading[1]!);
      group = { title, breaking: /breaking/i.test(title), items: [] };
      raws.set(group, []);
      current.groups.push(group);
      item = undefined;
      continue;
    }
    if (!group) continue;

    if (!line.trim()) {
      item = undefined;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      item = { raw: bullet[1]! };
      raws.get(group)!.push(item);
    } else if (item) {
      // A bullet that runs over more lines.
      item.raw += ` ${line.trim()}`;
    } else {
      // Prose under a group heading: kept as an item of its own, so nothing is lost.
      item = { raw: line.trim() };
      raws.get(group)!.push(item);
    }
  }

  for (const release of releases) {
    for (const group of release.groups) group.items = raws.get(group)!.map(({ raw }) => parseItem(raw));
    release.groups = release.groups.filter((group) => group.items.length > 0);
    release.groups.sort((a, b) => Number(b.breaking) - Number(a.breaking));
  }
  return releases;
}

const COMMIT = /\s*\(\[[0-9a-f]{7,40}\]\([^)\s]*\)\)\s*$/;
const PR = /\s*\(\[#(\d+)\]\([^)\s]*\)\)\s*$/;
const ISSUES = String.raw`((?:\[#\d+\]\([^)\s]*\)[,\s]*)+)`;
const CLOSES_PAREN = new RegExp(String.raw`\s*\(closes\s+${ISSUES}\)\s*$`, 'i');
const CLOSES_TAIL = new RegExp(String.raw`,?\s*closes\s+${ISSUES}$`, 'i');

/** One bullet: the scope and the commit link go, the pull request and the closed issues stay. */
export function parseItem(raw: string): ChangelogItem {
  let text = raw.trim().replace(/^\*\*[^*]+:\*\*\s*/, '');
  let pr: number | undefined;
  const closes: number[] = [];

  for (;;) {
    let match: RegExpExecArray | null;
    if ((match = COMMIT.exec(text))) {
      text = text.slice(0, match.index);
    } else if ((match = PR.exec(text))) {
      pr ??= Number(match[1]);
      text = text.slice(0, match.index);
    } else if ((match = CLOSES_PAREN.exec(text) ?? CLOSES_TAIL.exec(text))) {
      closes.unshift(...[...match[1]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
      text = text.slice(0, match.index);
    } else {
      break;
    }
  }

  text = text.trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { text: parseInline(text), pr, closes };
}

/** Inline code, bold and links; everything else is plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ type: 'code', text: match[1] });
    else if (match[2] !== undefined) out.push({ type: 'strong', text: match[2] });
    else out.push({ type: 'link', text: match[3]!, href: match[4]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** A pull request on GitHub. The changelog links `/issues/N`; GitHub redirects, but this is right. */
export function pullUrl(number: number): string {
  return `${GITHUB}/pull/${number}`;
}

/** An issue on GitHub. */
export function issueUrl(number: number): string {
  return `${GITHUB}/issues/${number}`;
}

/** CHANGELOG.md at the repository root. Astro builds and the tests run from apps/site. */
export function changelogFile(): string {
  return path.resolve(process.cwd(), '../../CHANGELOG.md');
}

/** The releases in CHANGELOG.md, newest first. */
export function readChangelog(): Release[] {
  return parseChangelog(fs.readFileSync(changelogFile(), 'utf8'));
}
