/** Links used across the site. */
export const GITHUB = 'https://github.com/Strom-Capital/spooldoc';

export const links = {
  github: GITHUB,
  discussions: `${GITHUB}/discussions`,
  releases: `${GITHUB}/releases`,
  issues: `${GITHUB}/issues`,
  license: `${GITHUB}/blob/main/LICENSE`,
  changelog: `${GITHUB}/blob/main/CHANGELOG.md`,
  image: 'https://github.com/Strom-Capital/spooldoc/pkgs/container/spooldoc',
  carbone: 'https://carbone.io',
} as const;

/** A path inside this site, with the configured base. */
export function url(path: string): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * A guide on this site: `/docs/` for the index, `/docs/jobs/` for a page, with the
 * trailing slash the built pages are served at.
 *
 * @param slug - The guide's file name without `.md`; none for the index
 * @param anchor - A heading id on that page, without `#`
 */
export function docsUrl(slug?: string, anchor?: string): string {
  return url(`/docs/${slug ? `${slug}/` : ''}${anchor ? `#${anchor}` : ''}`);
}

/** 21 October 2026 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
