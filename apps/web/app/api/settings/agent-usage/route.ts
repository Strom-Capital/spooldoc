import { agentUsageView } from '@/lib/server/agent-usage';
import { guard } from '@/lib/server/auth';
import { safeZone } from '@/lib/server/dashboard';
import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** The agent's usage this month and last month, per provider and model, in calendar months of time zone `tz`. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json(await agentUsageView(safeZone(new URL(request.url).searchParams.get('tz'))));
}
