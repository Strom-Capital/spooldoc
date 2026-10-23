import type postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionLocks } from '@/lib/server/db';
import { setLogSink } from '@/lib/server/log';

/** A postgres.js client whose reserved connections answer from `answer`, and record their queries and release. */
function stubClient(answer: (query: string, connection: number) => unknown) {
  const queries: { connection: number; query: string }[] = [];
  const released: number[] = [];
  let connections = 0;
  const client = {
    async reserve() {
      const connection = ++connections;
      const tag = async (strings: TemplateStringsArray) => {
        const query = strings.join('$');
        queries.push({ connection, query });
        return answer(query, connection);
      };
      return Object.assign(tag, { release: () => released.push(connection) });
    },
  };
  return { client: client as unknown as postgres.Sql, queries, released };
}

function captureLog(): { level: string; msg: string; [field: string]: unknown }[] {
  const lines: { level: string; msg: string }[] = [];
  process.env.SPOOLDOC_LOG_LEVEL = 'info';
  setLogSink((line) => lines.push(JSON.parse(line)));
  return lines;
}

afterEach(() => {
  setLogSink(null);
  process.env.SPOOLDOC_LOG_LEVEL = 'off';
});

describe('session locks', () => {
  it('unlock on the connection that took the lock, and keep it', async () => {
    const stub = stubClient(() => [{ ok: true }]);
    const locks = sessionLocks(stub.client);
    const release = await locks.tryLock('alerts');
    await release!();
    expect(stub.queries).toEqual([
      { connection: 1, query: 'select pg_try_advisory_lock(hashtext($)) as ok' },
      { connection: 1, query: 'select pg_advisory_unlock(hashtext($))' },
    ]);
    expect(stub.released).toEqual([]);
    expect(await locks.tryLock('alerts')).toBeTypeOf('function');
  });

  it('log a failed unlock, and free every lock before the connection goes back to the pool', async () => {
    const log = captureLog();
    const stub = stubClient((query) => {
      if (query.startsWith('select pg_advisory_unlock(')) throw new Error('connection reset');
      return [{ ok: true }];
    });
    const locks = sessionLocks(stub.client);
    const release = await locks.tryLock('alerts');
    await release!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log).toMatchObject([{ level: 'warn', msg: 'Could not release a database lock', lock: 'alerts', error: 'connection reset' }]);
    expect(stub.queries.map((q) => `${q.connection}: ${q.query}`)).toEqual([
      '1: select pg_try_advisory_lock(hashtext($)) as ok',
      '1: select pg_advisory_unlock(hashtext($))',
      '1: select pg_advisory_unlock_all()',
    ]);
    expect(stub.released).toEqual([1]);
    // The next lock is taken on a new connection.
    await locks.tryLock('alerts');
    expect(stub.queries.at(-1)).toEqual({ connection: 2, query: 'select pg_try_advisory_lock(hashtext($)) as ok' });
  });

  it('close a dropped connection that cannot free its locks, instead of returning it to the pool', async () => {
    captureLog();
    const stub = stubClient((query) => {
      if (query.startsWith('select pg_advisory_unlock')) throw new Error('connection reset');
      return [{ ok: true }];
    });
    const locks = sessionLocks(stub.client);
    const release = await locks.tryLock('alerts');
    await release!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stub.queries.at(-1)).toEqual({ connection: 1, query: 'select pg_terminate_backend(pg_backend_pid())' });
    expect(stub.released).toEqual([]);
  });
});
