import type { APIContext } from 'astro';
import { docsNav, siteVersion } from '../lib/docs';
import { llmsTxt } from '../lib/llms';
import { getPosts } from '../lib/posts';

/** Summary for language models and crawlers, per https://llmstxt.org. Written by lib/llms.ts. */
export async function GET(context: APIContext) {
  const body = llmsTxt({ site: context.site!, nav: docsNav(), posts: await getPosts(), version: siteVersion() });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
