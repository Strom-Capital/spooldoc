import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Pages need a signed-in user; without a session cookie they go to /login. The pages
 * check the session itself on the server, and API routes answer 401 on their own.
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  const login = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') {
    login.searchParams.set('next', next);
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Everything but the login page, the API, Next.js assets and public files.
  matcher: ['/((?!login|api/|_next/|brand/|favicon).*)'],
};
