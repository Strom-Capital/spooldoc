import type { PostLike } from './sortPosts';
import { docsUrl, links, url } from './links';

/** A schema.org JSON-LD object. */
export type JsonLd = Record<string, unknown>;

export const SITE_NAME = 'Spooldoc';
/**
 * The home page's title and the features page's description, in the words people search
 * with. They are the only place the site uses the searcher's short word for a spooled file;
 * the pages and the guides say "spooled file" (tests/site.test.ts).
 */
export const HOME_TITLE = 'Spooldoc: IBM i spool files to PDF, Word and Excel';
export const FEATURES_DESCRIPTION =
  'What Spooldoc does with IBM i spool files today: YAML definitions read the pages, and HTML, Word or Excel templates make PDF, HTML, DOCX or XLSX files. The agent drafts, and every run is in the job log.';
/** The brand guide's 25-word description: the meta description of the home page. */
export const SITE_DESCRIPTION =
  'Spooldoc turns IBM i spooled files into documents. A YAML definition reads each page into data; HTML, Word or Excel templates lay it out. Open source.';

/** The brand guide's 75-word description: the home page's lead, its JSON-LD and llms.txt. */
export const LONG_DESCRIPTION =
  'Spooldoc turns IBM i spooled files into documents. It watches your output queues and reads each spooled file into JSON with a definition you write in YAML. Templates in HTML, Word or Excel make PDF, HTML, DOCX or XLSX files, delivered to a download or a folder in the IFS. The agent proposes the first definition and template from a sample; you check every value next to the page. Nothing is installed on the IBM i. MIT licensed.';

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
    description: LONG_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Linux (Docker), amd64 and arm64',
    url: home,
    image: abs('/og.png', site),
    license: 'https://opensource.org/licenses/MIT',
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

/**
 * A guide: the article, and for a page under /docs the breadcrumb Docs > page. The two go
 * in one `@graph`, as the page has one JSON-LD script.
 *
 * @param slug - The guide's slug; none for /docs
 * @param dateModified - The last commit to the guide's file, when git can tell
 */
export function docsJsonLd({ site, slug, title, description, dateModified }: { site: URL; slug?: string; title: string; description: string; dateModified?: Date }): JsonLd {
  const pageUrl = abs(docsUrl(slug), site);
  const docs = abs(docsUrl(), site);
  const article: JsonLd = {
    '@type': 'TechArticle',
    '@id': `${pageUrl}#article`,
    mainEntityOfPage: pageUrl,
    url: pageUrl,
    headline: title,
    description,
    dateModified: dateModified?.toISOString(),
    inLanguage: 'en',
    author: organization(),
    publisher: organization(),
    isPartOf: slug ? { '@type': 'CollectionPage', name: `${SITE_NAME} docs`, url: docs } : { '@type': 'WebSite', name: SITE_NAME, url: abs('/', site) },
  };
  const breadcrumb: JsonLd = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Docs', item: docs },
      { '@type': 'ListItem', position: 2, name: title, item: pageUrl },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': slug ? [article, breadcrumb] : [article] };
}

/** Serialize for a `<script type="application/ld+json">` tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
