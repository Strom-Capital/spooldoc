import { guard } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { checkCarbone, getRendering } from '@/lib/server/rendering';

export const dynamic = 'force-dynamic';

/** Check the Carbone connection again now, such as after Carbone was given Spooldoc's public key. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  await checkCarbone();
  return json(await getRendering());
}
