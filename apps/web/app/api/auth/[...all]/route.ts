import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/server/auth';
import { getLocks } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Sign-up, sign-in, sign-out and session endpoints of Better Auth. */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  const handler = toNextJsHandler(getAuth()).POST;
  if (!new URL(request.url).pathname.endsWith('/sign-up/email')) {
    return handler(request);
  }
  // Only the first account may sign up (see the hook in auth.ts). One sign-up at a time,
  // across instances, so two at once cannot both find no account yet.
  const release = await getLocks().tryLock('sign-up');
  if (!release) {
    return Response.json({ code: 'SIGN_UP_BUSY', message: 'Another sign-up is in progress. Try again.' }, { status: 429 });
  }
  try {
    return await handler(request);
  } finally {
    await release();
  }
}
