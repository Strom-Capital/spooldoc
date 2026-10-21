import { docsSections } from '../../lib/docs';

/** Every section of every guide, for the search in the docs (DocsSearch.astro). Written at build time. */
export function GET(): Response {
  return Response.json(docsSections());
}
