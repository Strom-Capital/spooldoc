import { describe, expect, it, vi } from 'vitest';
import { fixtureText } from './helpers/fake-connection';
import { appRequest, params } from './helpers/mocks';

vi.mock('next/headers', async () => ({ cookies: async () => (await import('./helpers/mocks')).jar }));

const { GET, PUT } = await import('@/app/api/files/[kind]/[type]/route');

type Ctx = Parameters<typeof GET>[1];
const ctx = (kind: string, type: string) => params({ kind, type }) as Ctx;
const put = (kind: string, type: string, content: string) =>
  PUT(appRequest(`/api/files/${kind}/${type}`, { method: 'PUT', body: { content } }), ctx(kind, type));
const get = (kind: string, type: string) => GET(appRequest(`/api/files/${kind}/${type}`), ctx(kind, type));

describe('/api/files', () => {
  it('refuses an invalid definition with 400 and the message', async () => {
    const response = await put('definitions', 'invoice', 'type: invoice\nversion: 2\nsource: text\n');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Invalid definition/);
    expect((await get('definitions', 'invoice')).status).toBe(404);
  });

  it('refuses a definition saved under another type', async () => {
    const response = await put('definitions', 'other', fixtureText('invoice', 'definition.yaml'));
    expect(response.status).toBe(400);
  });

  it('refuses `..` and uppercase type names', async () => {
    for (const type of ['..', '../x', 'Invoice', 'INVOICE', 'a.b']) {
      expect((await put('templates', type, '<p></p>')).status).toBe(400);
      expect((await get('definitions', type)).status).toBe(400);
    }
    expect((await get('secrets', 'invoice')).status).toBe(404);
  });

  it('round-trips a definition and a template', async () => {
    const yaml = fixtureText('invoice', 'definition.yaml');
    const saved = await put('definitions', 'invoice', yaml);
    expect(saved.status).toBe(200);
    const read = await (await get('definitions', 'invoice')).json();
    expect(read.content).toBe(yaml);
    expect(read.updatedAt).toEqual(expect.any(String));

    // Before a template is saved, GET returns the starter template for the definition.
    const starter = await (await get('templates', 'invoice')).json();
    expect(starter.generated).toBe(true);
    expect(starter.content).toContain('{{ doc.invoiceNo }}');

    const html = fixtureText('invoice', 'template.html');
    expect((await put('templates', 'invoice', html)).status).toBe(200);
    const template = await (await get('templates', 'invoice')).json();
    expect(template.content).toBe(html);
    expect(template.generated).toBeUndefined();
  });

  it('refuses a PUT from another origin', async () => {
    const response = await PUT(
      appRequest('/api/files/templates/invoice', {
        method: 'PUT',
        body: { content: 'x' },
        headers: { origin: 'https://evil.example.com' },
      }),
      ctx('templates', 'invoice'),
    );
    expect(response.status).toBe(403);
  });
});
