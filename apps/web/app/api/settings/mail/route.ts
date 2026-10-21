import { guard } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { sendTestEmail } from '@/lib/server/mail';

export const dynamic = 'force-dynamic';

/** Send a test email to the signed-in user with the saved mail server. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  try {
    await sendTestEmail(auth.user.email);
  } catch (error) {
    const detail = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? error.detail : undefined;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error), ...(detail ? { detail } : {}) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return json({ to: auth.user.email });
}
