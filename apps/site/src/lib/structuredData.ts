import type { PostLike } from './sortPosts';
import { docsUrl, links, url } from './links';

/** A schema.org JSON-LD object. */
export type JsonLd = Record<string, unknown>;

export const SITE_NAME = 'Spooldoc';
export const SITE_DESCRIPTION =
  'Spooled files into documents, for IBM i. Spooldoc watches output queues, reads each spooled file into JSON with a YAML definition, makes documents with HTML, Word or Excel templates and delivers the files. Open source, MIT licensed.';

/** Absolute URL for a path on this site. */
function abs(path: string, site: URL): string {
  return new URL(url(path), site).href;
}

function organization(): JsonLd {
  return {
    '@type': 'Organization',
    name: 'Ström Capital Oy',
    url: 'https://github.com/Strom-Capital',
  };
}

/** The home page: the software, its version and where its code is. */
export function homeJsonLd(site: URL, version: string): JsonLd {
  const home = abs('/', site);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${home}#software`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Linux (Docker), amd64 and arm64',
    url: home,
    image: abs('/og.png', site),
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    codeRepository: links.github,
    softwareVersion: version,
    releaseNotes: links.releases,
    softwareHelp: abs(docsUrl(), site),
    author: organization(),
  };
}

/** A blog post. */
export function postJsonLd(post: PostLike, site: URL): JsonLd {
  const postUrl = abs(`/blog/${post.id}/`, site);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${postUrl}#post`,
    mainEntityOfPage: postUrl,
    url: postUrl,
    headline: post.data.title,
    description: post.data.description,
    datePublished: post.data.date.toISOString(),
    image: abs('/og.png', site),
    keywords: post.data.tags.length ? post.data.tags.join(', ') : undefined,
    inLanguage: 'en',
    author: organization(),
    publisher: organization(),
    sameAs: post.data.originalUrl,
    isPartOf: { '@type': 'Blog', name: `${SITE_NAME} blog`, url: abs('/blog/', site) },
  };
}

/** Serialize for a `<script type="application/ld+json">` tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
