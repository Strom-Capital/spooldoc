import type { APIContext } from 'astro';
import { DOCS_INDEX_DESCRIPTION, docsIndex } from '../../lib/docs';
import { docsMarkdown } from '../../lib/docsMarkdown';

/** /docs as Markdown with absolute links, for language models. See lib/docsMarkdown.ts. */
export function GET({ site }: APIContext): Response {
  const index = docsIndex();
  const body = docsMarkdown({ title: index.title, description: DOCS_INDEX_DESCRIPTION, markdown: index.markdown, site: site! });
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
