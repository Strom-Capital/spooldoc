import { appRequest } from './mocks';

const { POST } = await import('@/app/api/auth/[...all]/route');

/** Create an account (only works while there is none) and return its session cookie. */
export async function signUp(email = 'admin@example.com', password = 'correct-horse-battery'): Promise<Response> {
  return POST(appRequest('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Admin', email, password } }));
}

/** The `cookie` header value from a Better Auth response. */
export function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
}

/** Sign up the first user and return headers that carry the session. */
export async function signedIn(): Promise<Record<string, string>> {
  const response = await signUp();
  if (!response.ok) throw new Error(`Sign-up failed: ${response.status} ${await response.text()}`);
  return { cookie: sessionCookie(response) };
}
