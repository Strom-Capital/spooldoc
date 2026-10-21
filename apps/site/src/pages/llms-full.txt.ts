import type { APIContext } from 'astro';
import { docsNav, docsPage, siteVersion } from '../lib/docs';
import { llmsFullTxt } from '../lib/llms';

/** The summary of /llms.txt, then every guide in full, in the order of the sidebar. Written by lib/llms.ts. */
export function GET(context: APIContext) {
  const nav = docsNav();
  const pages = nav.flatMap(({ pages }) => pages.map(({ slug }) => docsPage(slug)));
  const body = llmsFullTxt({ site: context.site!, pages, version: siteVersion() });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
