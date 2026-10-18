import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/** Sign-up, sign-in, sign-out and session endpoints of Better Auth. */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
