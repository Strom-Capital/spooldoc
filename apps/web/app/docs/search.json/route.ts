import { docsSections } from '@/lib/server/docs';

export const dynamic = 'force-static';

/** Every section of every guide, for the search in the docs. Written when the app is built. */
export function GET(): Response {
  return Response.json(docsSections());
}
