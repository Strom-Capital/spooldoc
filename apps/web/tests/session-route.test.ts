import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOD_PASSWORD } from './helpers/fake-connection';
import { appRequest, connections, jar, spyConsole } from './helpers/mocks';

vi.mock('next/headers', async () => ({ cookies: async () => (await import('./helpers/mocks')).jar }));
vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const { DELETE, GET, POST } = await import('@/app/api/session/route');
const { resetConfig } = await import('@/lib/server/config');

const signOn = (password: string) =>
  POST(appRequest('/api/session', { method: 'POST', body: { host: 'ibmi.example.com', user: 'demouser', password, library: 'mylib' } }));

describe('/api/session', () => {
  beforeEach(() => {
    jar.values.clear();
    connections.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    resetConfig();
  });

  it('answers a wrong password with 401 and the error text, without the password and without logging', async () => {
    const spies = spyConsole();
    const response = await signOn('Wrong-Secret-42');
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(text).error).toMatch(/Password is incorrect/);
    expect(text).not.toContain('Wrong-Secret-42');
    expect(jar.has('spooldoc')).toBe(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('signs on, sets the session cookie and never returns the password', async () => {
    const spies = spyConsole();
    const response = await signOn(GOOD_PASSWORD);
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(text)).toEqual({ host: 'ibmi.example.com', user: 'DEMOUSER', jobCcsid: 273, vrm: 'V7R5' });
    expect(text).not.toContain(GOOD_PASSWORD);
    expect(jar.get('spooldoc')?.value).toBeTruthy();
    expect(jar.get('spooldoc')?.value).not.toContain(GOOD_PASSWORD);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('reports the connection and the model without any key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';
    resetConfig();
    await signOn(GOOD_PASSWORD);

    const response = await GET(appRequest('/api/session'));
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body).toMatchObject({
      connected: true,
      host: 'ibmi.example.com',
      user: 'DEMOUSER',
      library: 'MYLIB',
      model: { provider: 'anthropic', id: 'claude-sonnet-5-5' },
      masking: true,
      pdf: false,
    });
    expect(text).not.toContain('sk-ant-test-key-123');
    expect(text).not.toContain(GOOD_PASSWORD);
  });

  it('reports no model and not connected for a new browser', async () => {
    const body = await (await GET(appRequest('/api/session'))).json();
    expect(body).toEqual({ connected: false, model: null, masking: true, pdf: false });
  });

  it('reports masking off when SPOOLDOC_MASK=false', async () => {
    process.env.SPOOLDOC_MASK = 'false';
    resetConfig();
    try {
      const body = await (await GET(appRequest('/api/session'))).json();
      expect(body.masking).toBe(false);
    } finally {
      delete process.env.SPOOLDOC_MASK;
      resetConfig();
    }
  });

  it('reports pdf: true when SPOOLDOC_CHROMIUM_PATH is an executable', async () => {
    process.env.SPOOLDOC_CHROMIUM_PATH = process.execPath;
    try {
      const body = await (await GET(appRequest('/api/session'))).json();
      expect(body.pdf).toBe(true);
    } finally {
      delete process.env.SPOOLDOC_CHROMIUM_PATH;
    }
  });

  it('DELETE closes the connection and clears the session', async () => {
    await signOn(GOOD_PASSWORD);
    const conn = [...connections.values()][0];

    const response = await DELETE(appRequest('/api/session', { method: 'DELETE' }));

    expect(response.status).toBe(204);
    expect(conn?.closed).toBe(true);
    expect(jar.has('spooldoc')).toBe(false);
    expect((await (await GET(appRequest('/api/session'))).json()).connected).toBe(false);
  });

  it('refuses a host outside SPOOLDOC_ALLOWED_HOSTS', async () => {
    process.env.SPOOLDOC_ALLOWED_HOSTS = 'other.example.com';
    resetConfig();
    try {
      const response = await signOn(GOOD_PASSWORD);
      expect(response.status).toBe(400);
      expect(connections.size).toBe(0);
    } finally {
      delete process.env.SPOOLDOC_ALLOWED_HOSTS;
      resetConfig();
    }
  });

  it('refuses a POST from another origin', async () => {
    const response = await POST(
      appRequest('/api/session', {
        method: 'POST',
        body: { host: 'ibmi.example.com', user: 'demouser', password: GOOD_PASSWORD },
        headers: { origin: 'https://evil.example.com' },
      }),
    );
    expect(response.status).toBe(403);
    expect(connections.size).toBe(0);
  });
});
