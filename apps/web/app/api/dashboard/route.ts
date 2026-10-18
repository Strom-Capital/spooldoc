import { guard } from '@/lib/server/auth';
import { dashboard, RANGES, safeZone } from '@/lib/server/dashboard';
import { errorResponse, json } from '@/lib/server/http';
import type { DashboardRange } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The Home page: setup progress, counts, and runs per hour or day over `range`, in time zone `tz`. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const search = new URL(request.url).searchParams;
  const range = (search.get('range') ?? '7d') as DashboardRange;
  if (!Object.hasOwn(RANGES, range)) {
    return errorResponse(400, 'Range must be 24h, 7d, 30d or 90d.');
  }
  return json(await dashboard(range, safeZone(search.get('tz'))));
}
