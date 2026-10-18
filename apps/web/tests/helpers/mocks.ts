import { ConnectionError, type Credentials } from '@spooldoc/ibmi';
import { vi } from 'vitest';
import { FakeConnection, GOOD_PASSWORD } from './fake-connection';

/** An in-memory stand-in for the `cookies()` store of next/headers. */
export class CookieJar {
  readonly values = new Map<string, string>();
  get(name: string): { name: string; value: string } | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, options?: { maxAge?: number }): void {
    if (value === '' || options?.maxAge === 0) this.values.delete(name);
    else this.values.set(name, value);
  }
  delete(name: string): void {
    this.values.delete(name);
  }
  has(name: string): boolean {
    return this.values.has(name);
  }
  getAll(): { name: string; value: string }[] {
    return [...this.values].map(([name, value]) => ({ name, value }));
  }
}

export const jar = new CookieJar();
export const connections = new Map<string, FakeConnection>();

/** The fake jt400 module: accepts GOOD_PASSWORD, refuses anything else like the real system. */
export const fakeJt400 = {
  connectionKey: (creds: Credentials) => `${creds.host}|${creds.user}`,
  getConnection: vi.fn(async (creds: Credentials) => {
    if (creds.password !== GOOD_PASSWORD) {
      throw new ConnectionError('auth', `Password is incorrect for user ${creds.user.toUpperCase()}.`);
    }
    const key = `${creds.host}|${creds.user}`;
    let conn = connections.get(key);
    if (!conn) {
      conn = new FakeConnection();
      connections.set(key, conn);
    }
    return conn;
  }),
  closeConnection: vi.fn(async (key: string) => {
    await connections.get(key)?.close();
    connections.delete(key);
  }),
};

/** A request to the app with the Origin of the app, as a browser would send it. */
export function appRequest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      ...(method === 'GET' ? { 'sec-fetch-site': 'same-origin' } : { origin: 'http://localhost:3000', 'content-type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Route handler context with params. */
export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

/** Spies on every console method; returns them so a test can assert none was called. */
export function spyConsole() {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
}
