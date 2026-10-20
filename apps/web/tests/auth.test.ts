import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';
import { sessionCookie, signUp } from './helpers/auth';
import { appRequest } from './helpers/mocks';

const { POST } = await import('@/app/api/auth/[...all]/route');

const { currentUser, requireUser, userCount } = await import('@/lib/server/auth');

describe('app login', () => {
  beforeEach(() => resetTables(db()));

  it('lets the first user sign up and then closes sign-up', async () => {
    expect(await userCount()).toBe(0);
    const first = await signUp();
    expect(first.status).toBe(200);
    expect(await userCount()).toBe(1);

    const second = await signUp('other@example.com');
    expect(second.status).toBe(403);
    expect((await second.json()).message).toBe('Sign-up is closed: this Spooldoc has one account, created when it was set up. Sign in with that account.');
    expect(await userCount()).toBe(1);
  });

  it('lets only one of two sign-ups at the same time through', async () => {
    const responses = await Promise.all([signUp('a@example.com'), signUp('b@example.com')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(await userCount()).toBe(1);
  });

  it('finds the user from the session cookie and answers 401 without one', async () => {
    const cookie = sessionCookie(await signUp());
    const user = await currentUser(appRequest('/api/jobs', { headers: { cookie } }));
    expect(user).toMatchObject({ email: 'admin@example.com', name: 'Admin' });

    const refused = await requireUser(appRequest('/api/jobs'));
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(401);
  });

  it('refuses a short password', async () => {
    const response = await signUp('admin@example.com', 'short');
    expect(response.status).toBe(400);
  });

  it('changes the name, and the session shows it', async () => {
    const cookie = sessionCookie(await signUp());
    const response = await POST(appRequest('/api/auth/update-user', { method: 'POST', headers: { cookie }, body: { name: 'Dev User' } }));
    expect(response.status).toBe(200);
    expect(await currentUser(appRequest('/api/jobs', { headers: { cookie } }))).toMatchObject({ name: 'Dev User', email: 'admin@example.com' });
  });

  it('refuses a wrong current password with the code the Profile page reads', async () => {
    const cookie = sessionCookie(await signUp());
    const response = await changePassword(cookie, 'wrong-password-123', 'another-long-password');
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_PASSWORD');
  });

  it('refuses a short new password with the code the Profile page reads', async () => {
    const cookie = sessionCookie(await signUp());
    const response = await changePassword(cookie, 'correct-horse-battery', 'short');
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('PASSWORD_TOO_SHORT');
  });

  it('changes the password and signs out the other sessions', async () => {
    const other = sessionCookie(await signUp());
    const signIn = await POST(appRequest('/api/auth/sign-in/email', { method: 'POST', body: { email: 'admin@example.com', password: 'correct-horse-battery' } }));
    const cookie = sessionCookie(signIn);

    const response = await changePassword(cookie, 'correct-horse-battery', 'another-long-password');
    expect(response.status).toBe(200);
    const kept = sessionCookie(response) || cookie;
    expect(await currentUser(appRequest('/api/jobs', { headers: { cookie: kept } }))).not.toBeNull();
    expect(await currentUser(appRequest('/api/jobs', { headers: { cookie: other } }))).toBeNull();
  });
});

function changePassword(cookie: string, currentPassword: string, newPassword: string): Promise<Response> {
  return POST(
    appRequest('/api/auth/change-password', { method: 'POST', headers: { cookie }, body: { currentPassword, newPassword, revokeOtherSessions: true } }),
  );
}
