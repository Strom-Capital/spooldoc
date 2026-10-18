import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';
import { sessionCookie, signUp } from './helpers/auth';
import { appRequest } from './helpers/mocks';

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
    expect((await second.json()).message).toMatch(/Sign-up is closed/);
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
});
