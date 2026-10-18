import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { setDismissed } from '@/lib/server/dashboard';
import { readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const dismissSchema = z.object({
  items: z.array(z.object({ kind: z.enum(['server', 'job', 'run']), id: z.string().uuid() })).min(1).max(200),
  dismissed: z.boolean().default(true),
});

/** Dismiss items from Needs attention on Home, or with `dismissed: false` bring them back. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, dismissSchema);
  if ('response' in body) {
    return body.response;
  }
  await setDismissed(body.data.items, body.data.dismissed);
  return new Response(null, { status: 204 });
}
