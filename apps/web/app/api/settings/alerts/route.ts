import { getAlertsView, NO_ALERT_ADDRESSES, sendTestAlert } from '@/lib/server/alerts';
import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Send a test alert to the saved alert addresses with the saved mail server. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  if (!(await getAlertsView()).to) {
    return errorResponse(400, NO_ALERT_ADDRESSES);
  }
  try {
    return json(await sendTestAlert());
  } catch (error) {
    const detail = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? error.detail : undefined;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error), ...(detail ? { detail } : {}) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
