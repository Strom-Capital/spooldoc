import { beforeEach, describe, expect, it } from 'vitest';
import type { SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const route = await import('@/app/api/settings/route');

let auth: Record<string, string>;

const put = (body: unknown) => route.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }));

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('settings', () => {
  it('returns the intervals and the retention', async () => {
    const response = await route.GET(appRequest('/api/settings', { headers: auth }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pollSeconds: 30, safetyCheckSeconds: 300, retentionDays: 90, cleanup: null });
  });

  it('changes the retention and leaves the other settings alone', async () => {
    const response = await put({ retentionDays: 30 });
    expect(response.status).toBe(200);
    expect((await response.json()) as SettingsView).toMatchObject({ pollSeconds: 30, safetyCheckSeconds: 300, retentionDays: 30 });
    expect(await (await route.GET(appRequest('/api/settings', { headers: auth }))).json()).toMatchObject({ retentionDays: 30 });
  });

  it.each([
    [{ retentionDays: 0 }, 'Keep runs at least 1 day'],
    [{ retentionDays: 3651 }, 'Keep runs at most 3650 days'],
    [{ retentionDays: 1.5 }, ''],
    [{ retentionDays: '30' }, ''],
  ])('refuses %j', async (body, message) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(message);
    expect(await (await route.GET(appRequest('/api/settings', { headers: auth }))).json()).toMatchObject({ retentionDays: 90 });
  });

  it('accepts the limits', async () => {
    expect((await put({ retentionDays: 1 })).status).toBe(200);
    expect((await put({ retentionDays: 3650 })).status).toBe(200);
  });

  it('needs a session', async () => {
    expect((await route.PUT(appRequest('/api/settings', { method: 'PUT', body: { retentionDays: 30 } }))).status).toBe(401);
  });
});
