import { describe, expect, it, vi } from 'vitest';
import { GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { appRequest } from './helpers/mocks';

vi.mock('next/headers', async () => ({ cookies: async () => (await import('./helpers/mocks')).jar }));
vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const { POST: signOn } = await import('@/app/api/session/route');
const { POST: capture } = await import('@/app/api/capture/route');
const { GET: listSamples } = await import('@/app/api/samples/route');
const { getWorkspace } = await import('@/lib/server/workspace');

describe('/api/capture', () => {
  it('needs a sign-on', async () => {
    const splf = loadSample('invoice').splf;
    const response = await capture(appRequest('/api/capture', { method: 'POST', body: { splf } }));
    expect(response.status).toBe(401);
  });

  it('captures a spooled file through the connection into the workspace', async () => {
    await signOn(
      appRequest('/api/session', { method: 'POST', body: { host: 'ibmi.example.com', user: 'demouser', password: GOOD_PASSWORD } }),
    );
    const fixture = loadSample('invoice');

    const response = await capture(appRequest('/api/capture', { method: 'POST', body: { splf: fixture.splf } }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: fixture.id, pages: 8, codePage: 273, codePageSource: 'chrid', warnings: [] });
    const written = await getWorkspace().readSample(fixture.id);
    expect(written?.pages).toEqual(fixture.pages);
    expect(written?.system).toBe('ibmi.example.com');

    const list = await (await listSamples(appRequest('/api/samples'))).json();
    expect(list.samples).toEqual([
      expect.objectContaining({ id: fixture.id, pages: 8, codePage: 273, definition: null }),
    ]);
  });

  it('answers 404 for a spooled file that is gone', async () => {
    const splf = { ...loadSample('invoice').splf, number: 999 };
    const response = await capture(appRequest('/api/capture', { method: 'POST', body: { splf } }));
    expect(response.status).toBe(404);
  });

  it('refuses a body that is not a spooled file id', async () => {
    const response = await capture(appRequest('/api/capture', { method: 'POST', body: { splf: { name: 'X' } } }));
    expect(response.status).toBe(400);
  });
});
