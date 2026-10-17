import { describe, expect, it, vi } from 'vitest';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { appRequest, params } from './helpers/mocks';

vi.mock('next/headers', async () => ({ cookies: async () => (await import('./helpers/mocks')).jar }));

const { GET, POST } = await import('@/app/api/render/[id]/route');
const { getWorkspace } = await import('@/lib/server/workspace');

const sample = loadSample('invoice');
const ws = getWorkspace();
await ws.writeSample({ ...sample, definition: 'invoice' });
await ws.writeDefinition('invoice', fixtureText('invoice', 'definition.yaml'));
await ws.writeTemplate('invoice', fixtureText('invoice', 'template.html'));

type Ctx = Parameters<typeof GET>[1];
const ctx = (id: string) => params({ id }) as Ctx;

describe('/api/render/[id]', () => {
  it('renders the saved definition and template: six documents with hits', async () => {
    const response = await GET(appRequest(`/api/render/${sample.id}`), ctx(sample.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.errors).toEqual([]);
    expect(body.sample.rawBase64).toBeUndefined();
    expect(body.sample.codePageSource).toBe('chrid');
    expect(body.definition.type).toBe('invoice');
    expect(body.extract.documents).toHaveLength(6);
    expect(body.extract.documents[0].invoiceNo).toBe('260101');
    expect(body.extract.hits.length).toBeGreaterThan(0);
    expect(body.extract.hits.some((hit: { status: string }) => hit.status === 'missing')).toBe(false);
    expect(body.html).toContain('260101');
  });

  it('renders another document with ?document=', async () => {
    const body = await (await GET(appRequest(`/api/render/${sample.id}?document=1`), ctx(sample.id))).json();
    expect(body.document).toBe(1);
    expect(body.html).toContain('MÄKELÄ RAKENNUS OY');
  });

  it('reports broken YAML in the result with status 200', async () => {
    const response = await POST(
      appRequest(`/api/render/${sample.id}`, { method: 'POST', body: { yaml: 'type: invoice\nversion: [1\n' } }),
      ctx(sample.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.definition.error).toMatch(/YAML/);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.extract).toBeUndefined();
  });

  it('uses a generated starter template when there is none', async () => {
    const yaml = fixtureText('invoice', 'definition.yaml').replace('type: invoice', 'type: other');
    const body = await (
      await POST(appRequest(`/api/render/${sample.id}`, { method: 'POST', body: { yaml } }), ctx(sample.id))
    ).json();
    // The sample is linked to `invoice`, whose template exists; an unlinked sample gets the starter.
    expect(body.template.generated).toBeUndefined();

    await ws.writeSample({ ...sample, id: 'UNLINKED-1' });
    const unlinked = await (
      await POST(appRequest('/api/render/UNLINKED-1', { method: 'POST', body: { yaml } }), ctx('UNLINKED-1'))
    ).json();
    expect(unlinked.template.generated).toBe(true);
    expect(unlinked.html).toContain('260101');
  });

  it('answers 404 for an unknown sample and 400 for a bad id', async () => {
    expect((await GET(appRequest('/api/render/NOPE'), ctx('NOPE'))).status).toBe(404);
    expect((await GET(appRequest('/api/render/..'), ctx('..'))).status).toBe(400);
  });
});
