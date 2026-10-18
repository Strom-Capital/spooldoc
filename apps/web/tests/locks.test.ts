import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { sessionLocks } from '@/lib/server/db';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('session locks (TEST_DATABASE_URL)', () => {
  // One provider per client, as in the app: each keeps one connection for its locks.
  const one = postgres(url ?? '', { max: 2, onnotice: () => undefined });
  const two = postgres(url ?? '', { max: 2, onnotice: () => undefined });
  const three = postgres(url ?? '', { max: 2, onnotice: () => undefined });
  afterAll(() => Promise.all([one, two, three].map((client) => client.end({ timeout: 5 }))));

  it('refuses a key held in this process and in another one, and frees it on release', async () => {
    const here = sessionLocks(one);
    const there = sessionLocks(two);
    const release = await here.tryLock('test:a');
    expect(release).toBeTypeOf('function');
    expect(await here.tryLock('test:a')).toBeNull();
    expect(await there.tryLock('test:a')).toBeNull();
    await release!();
    const again = await there.tryLock('test:a');
    expect(again).toBeTypeOf('function');
    await again!();
  });

  it('holds many locks on one connection, leaving the pool free', async () => {
    const locks = sessionLocks(three);
    const releases = await Promise.all(Array.from({ length: 20 }, (_, i) => locks.tryLock(`test:many:${i}`)));
    expect(releases.every((r) => typeof r === 'function')).toBe(true);
    // The other connection of the pool still answers queries while twenty locks are held.
    expect(await Promise.all([three`select 1 as n`, three`select 2 as n`])).toHaveLength(2);
    await Promise.all(releases.map((r) => r!()));
  });
});
