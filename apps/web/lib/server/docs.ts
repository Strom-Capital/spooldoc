import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import * as docs from '@spooldoc/docs';
import type { DocsGroup, DocsOptions, DocsPage, DocsSection } from '@spooldoc/docs';
import { REPOSITORY } from '@/lib/repository';

export type { DocsGroup, DocsHeading, DocsNavPage, DocsPage, DocsSection } from '@spooldoc/docs';

/**
 * The guides in docs/, served at /docs. The folder is read only while `next build`
 * prerenders the docs routes: the Docker image has no docs/ folder at runtime.
 * The reading itself is in @spooldoc/docs; this passes it the folder, the repository
 * and the version.
 */

/** The docs/ folder at the repository root. */
export function docsFolder(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), '../../docs');
}

/** The version in the root package.json, which is the release tag without its `v`. */
export function docsVersion(): string {
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), '../../package.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
}

let options: DocsOptions | undefined;

function docsOptions(): DocsOptions {
  options ??= { folder: docsFolder(), repository: REPOSITORY, version: docsVersion() };
  return options;
}

/** The sidebar: each `##` group of docs/README.md and the pages in its table. */
export function docsNav(): DocsGroup[] {
  return docs.docsNav(docsOptions());
}

/**
 * One guide: its front matter, its Markdown ready for the app and its headings.
 *
 * @param slug - The file name without `.md`, such as `templates`
 */
export function docsPage(slug: string): DocsPage {
  return docs.docsPage(slug, docsOptions());
}

/** Every page in the order of the sidebar, cut into one section per `##` and `###` heading. */
export function docsSections(): DocsSection[] {
  return docs.docsSections(docsOptions());
}
