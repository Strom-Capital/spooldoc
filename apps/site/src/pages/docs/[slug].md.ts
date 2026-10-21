import type { APIContext } from 'astro';
import { docsPage, docsSlugs } from '../../lib/docs';
import { docsMarkdown } from '../../lib/docsMarkdown';

/** Each guide as Markdown with absolute links, for language models. See lib/docsMarkdown.ts. */
export function getStaticPaths() {
  return docsSlugs().map((slug) => ({ params: { slug } }));
}

export function GET({ params, site }: APIContext): Response {
  const page = docsPage(String(params.slug));
  const body = docsMarkdown({ title: page.title, description: page.description, slug: page.slug, markdown: page.markdown, site: site! });
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
