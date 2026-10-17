import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { appRequest, params } from './helpers/mocks';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fixed');

class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnavailableError';
  }
}

const renderPdf = vi.fn<(html: string, options?: { format?: string; landscape?: boolean }) => Promise<Uint8Array>>(async () => PDF_BYTES);

vi.mock('next/headers', async () => ({ cookies: async () => (await import('./helpers/mocks')).jar }));
vi.mock('@/lib/server/pdf', () => ({
  loadPdf: async () => ({ renderPdf }),
  pdfAvailable: async () => true,
}));

const { GET } = await import('@/app/api/pdf/[id]/route');
const { getWorkspace } = await import('@/lib/server/workspace');

const sample = loadSample('invoice');
const ws = getWorkspace();
await ws.writeSample({ ...sample, definition: 'invoice' });
await ws.writeDefinition('invoice', fixtureText('invoice', 'definition.yaml'));
await ws.writeTemplate('invoice', fixtureText('invoice', 'template.html'));

type Ctx = Parameters<typeof GET>[1];
const ctx = (id: string) => params({ id }) as Ctx;
const get = (id: string, query = '') => GET(appRequest(`/api/pdf/${id}${query}`), ctx(id));

describe('/api/pdf/[id]', () => {
  afterEach(() => {
    renderPdf.mockClear();
  });

  it('returns the PDF inline, named after the output name of the document', async () => {
    const response = await get(sample.id, '?document=1');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="invoice-260102.pdf"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    const [html, options] = renderPdf.mock.calls[0] ?? [];
    expect(html).toContain('260102');
    expect(options).toEqual({ format: 'A4', landscape: false });
  });

  it('renders the first document without ?document=', async () => {
    const response = await get(sample.id);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="invoice-260101.pdf"');
  });

  it('falls back to <sampleId>-<n>.pdf without an output name', async () => {
    const yaml = fixtureText('invoice', 'definition.yaml').replace(/\noutput:\n(?: {2}.*\n)+/, '\n');
    await ws.writeDefinition('noname', yaml.replace('type: invoice', 'type: noname'));
    await ws.writeSample({ ...sample, id: 'NONAME-1', definition: 'noname' });
    const response = await get('NONAME-1', '?document=2');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="NONAME-1-3.pdf"');
  });

  it('prints wide pages landscape unless the template sets @page size', async () => {
    const wide = { ...sample, id: 'WIDE-1', definition: 'wide', attributes: { ...sample.attributes, pageWidth: 198 } };
    await ws.writeSample(wide);
    await ws.writeDefinition('wide', fixtureText('invoice', 'definition.yaml').replace('type: invoice', 'type: wide'));
    await ws.writeTemplate('wide', '<html><body>{{ doc.invoiceNo }}</body></html>');
    await get('WIDE-1');
    expect(renderPdf.mock.calls[0]?.[1]).toEqual({ format: 'A4', landscape: true });

    await ws.writeTemplate('wide', '<html><head><style>@page { size: A4 portrait }</style></head><body>x</body></html>');
    await get('WIDE-1');
    expect(renderPdf.mock.calls[1]?.[1]).toEqual({ format: 'A4', landscape: false });
  });

  it('answers 501 when Chromium is not available', async () => {
    renderPdf.mockRejectedValueOnce(new PdfUnavailableError('SPOOLDOC_CHROMIUM_PATH is not set.'));
    const response = await get(sample.id);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'SPOOLDOC_CHROMIUM_PATH is not set.' });
  });

  it('answers 400 without a linked definition and for a document out of range', async () => {
    await ws.writeSample({ ...sample, id: 'UNLINKED-1', definition: undefined });
    const unlinked = await get('UNLINKED-1');
    expect(unlinked.status).toBe(400);
    expect((await unlinked.json()).error).toMatch(/no linked definition/);

    const outOfRange = await get(sample.id, '?document=6');
    expect(outOfRange.status).toBe(400);
    expect((await outOfRange.json()).error).toMatch(/0 to 5/);

    expect((await get(sample.id, '?document=-1')).status).toBe(400);
    expect((await get(sample.id, '?document=abc')).status).toBe(400);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('answers 422 with the template errors', async () => {
    await ws.writeSample({ ...sample, id: 'BROKEN-1', definition: 'broken' });
    await ws.writeDefinition('broken', fixtureText('invoice', 'definition.yaml').replace('type: invoice', 'type: broken'));
    await ws.writeTemplate('broken', '<p>{{ doc.invoiceNo | nosuchfilter }}</p>');
    const response = await get('BROKEN-1');
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error).toBeTruthy();
    expect(body.templateErrors.join('\n')).toMatch(/nosuchfilter/);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown sample', async () => {
    expect((await get('NOPE')).status).toBe(404);
  });
});
