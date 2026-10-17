import { unsealData } from 'iron-session';
import { NextResponse, type NextRequest } from 'next/server';

/** Same cookie name as lib/server/session.ts. */
const SESSION_COOKIE = 'spooldoc';

/** Pages that need an IBM i sign-on go to /connect without one. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const sealed = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET ?? '';
  if (sealed && secret.length >= 32) {
    const data = await unsealData<{ ibmi?: unknown }>(sealed, { password: secret }).catch(() => ({}) as { ibmi?: unknown });
    if (data.ibmi) {
      return NextResponse.next();
    }
  }
  return NextResponse.redirect(new URL('/connect', request.url));
}

export const config = {
  matcher: ['/queues', '/queues/:path*'],
};
