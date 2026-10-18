import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assets, jobs, runOutputs, runs, watchSeen } from '@/lib/server/db/schema';
import type { JobDetail, RunView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, connections, params, spyConsole } from './helpers/mocks';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fixed');
const renderPdf = vi.fn<(html: string, options?: { format?: string; landscape?: boolean }) => Promise<Uint8Array>>(async () => PDF_BYTES);

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);
vi.mock('@/lib/server/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/pdf')>()),
  loadPdf: async () => ({ renderPdf }),
  pdfAvailable: async () => true,
}));

const jobsRoute = await import('@/app/api/jobs/route');
const jobRoute = await import('@/app/api/jobs/[id]/route');
const previewSample = await import('@/app/api/jobs/[id]/preview-sample/route');
const renderRoute = await import('@/app/api/jobs/[id]/render/route');
const previewPdf = await import('@/app/api/jobs/[id]/preview-pdf/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');
const restore = await import('@/app/api/jobs/[id]/versions/[n]/restore/route');
const activate = await import('@/app/api/jobs/[id]/versions/[n]/activate/route');
const runsRoute = await import('@/app/api/jobs/[id]/runs/route');
const filesRoute = await import('@/app/api/jobs/[id]/files/route');
const runLog = await import('@/app/api/runs/route');
const fileRoute = await import('@/app/api/runs/[id]/files/[file]/route');

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const { library, name: queue } = sample.attributes.queue;

let auth: Record<string, string>;
let serverId: string;

const post = (path: string, body?: unknown) => appRequest(path, { method: 'POST', body: body ?? {}, headers: auth });
const patch = (path: string, body: unknown) => appRequest(path, { method: 'PATCH', body, headers: auth });
const get = (path: string) => appRequest(path, { headers: auth });

async function newJob(): Promise<string> {
  const response = await jobsRoute.POST(post('/api/jobs', { serverId, library, queue }));
  expect(response.status).toBe(201);
  return (await response.json()).id;
}

async function job(id: string): Promise<JobDetail> {
  return (await jobRoute.GET(get(`/api/jobs/${id}`), params({ id }))).json();
}

/** A job with the invoice definition, the template and the invoice sample as preview. */
async function readyJob(): Promise<string> {
  const id = await newJob();
  await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml }, render: { template, format: 'pdf' } } }), params({ id }));
  const captured = await previewSample.POST(post(`/api/jobs/${id}/preview-sample`, { splf: sample.splf }), params({ id }));
  expect(captured.status).toBe(201);
  return id;
}

/** The fake IBM i connection behind the test server. */
const fake = (): FakeConnection => connections.get('ibmi.example.com|DEMOUSER')!;

beforeEach(async () => {
  await resetTables(db());
  connections.clear();
  renderPdf.mockClear();
  auth = await signedIn();
  serverId = await insertServer();
});

describe('jobs', () => {
  it('creates a job on a queue with the built-in destination, and changes draft parts on their own', async () => {
    const id = await newJob();
    const created = await job(id);
    expect(created.name).toBe(`${library}/${queue}`);
    expect(created.draft.source).toMatchObject({ serverId, library, queue });
    expect(created.draft.destination.destinationId).toBeTruthy();
    expect(created.draft.finish).toEqual({ action: 'hold', queue: null });

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml } } }), params({ id }));
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch' } }, name: 'Invoices' }), params({ id }));
    const updated = await job(id);
    expect(updated.name).toBe('Invoices');
    expect(updated.draft.extract.definition).toBe(yaml);
    expect(updated.draft.trigger.mode).toBe('watch');
    expect(updated.draft.source.queue).toBe(queue);
  });

  it('captures a preview file without touching it and renders it with unsaved text', async () => {
    const id = await readyJob();
    expect(fake().actions()).toEqual([]);
    expect((await job(id)).draft.preview.sampleId).toBeTruthy();

    const result = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { document: 1 }), params({ id }))).json();
    expect(result.extract.documents).toHaveLength(6);
    expect(result.html).toContain('260102');

    const unsaved = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: '<p>{{ doc.invoiceNo }}</p>' }), params({ id }))).json();
    expect(unsaved.html).toBe('<p>260101</p>');
    const starter = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: null }), params({ id }))).json();
    expect(starter.template.generated).toBe(true);
  });

  it('downloads a preview PDF named after the output name, and reports problems', async () => {
    const id = await readyJob();
    const response = await previewPdf.POST(post(`/api/jobs/${id}/preview-pdf`, { document: 1 }), params({ id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="invoice-260102.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    expect(renderPdf.mock.calls[0]?.[1]).toEqual({ format: 'A4', landscape: false });

    expect((await previewPdf.POST(post(`/api/jobs/${id}/preview-pdf`, { document: 50 }), params({ id }))).status).toBe(400);
    const broken = await previewPdf.POST(post(`/api/jobs/${id}/preview-pdf`, { html: '{% if %}' }), params({ id }));
    expect(broken.status).toBe(422);
    expect((await broken.json()).templateErrors.length).toBeGreaterThan(0);
  });

  it('takes stock again when a watching job gets a version with the backlog on', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch', backlog: false } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await db().update(jobs).set({ lastWatchAt: new Date() }).where(eq(jobs.id, id));

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch', backlog: true } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [row] = await db().select().from(jobs).where(eq(jobs.id, id));
    expect(row!.activeVersion).toBe(2);
    expect(row!.lastWatchAt).toBeNull();
  });

  it('takes stock again when a watching job starts taking held files', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch', backlog: false, includeHeld: false } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await db().update(jobs).set({ lastWatchAt: new Date() }).where(eq(jobs.id, id));

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch', backlog: false, includeHeld: true } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [row] = await db().select().from(jobs).where(eq(jobs.id, id));
    expect(row!.lastWatchAt).toBeNull();
  });

  it('refuses to save an incomplete version and lists what is missing', async () => {
    const id = await newJob();
    const response = await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'first' }), params({ id }));
    expect(response.status).toBe(422);
    expect((await response.json()).problems).toEqual(['Extract: write a definition.']);
  });

  it('saves versions, activates, restores and keeps the preview out of versions', async () => {
    const id = await readyJob();
    const v1 = await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'first' }), params({ id }));
    expect(v1.status).toBe(201);
    expect((await v1.json()).number).toBe(1);

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { trigger: { mode: 'watch' } } }), params({ id }));
    const v2 = await (await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'watch', activate: false }), params({ id }))).json();
    expect(v2.number).toBe(2);
    expect(v2.job.activeVersion).toBe(1);

    const activated = await (await activate.POST(post(`/api/jobs/${id}/versions/2/activate`), params({ id, n: '2' }))).json();
    expect(activated.activeVersion).toBe(2);
    const [row] = await db().select().from(jobs).where(eq(jobs.id, id));
    expect(row!.watchSince).toBeInstanceOf(Date);
    expect(row!.lastWatchAt).toBeNull();

    const restored: JobDetail = await (await restore.POST(post(`/api/jobs/${id}/versions/1/restore`), params({ id, n: '1' }))).json();
    expect(restored.draft.trigger.mode).toBe('manual');
    expect(restored.draft.preview.sampleId).toBeTruthy();
    expect(restored.versions.map((v) => v.number)).toEqual([2, 1]);
    expect((await restore.POST(post(`/api/jobs/${id}/versions/9/restore`), params({ id, n: '9' }))).status).toBe(404);
  });
});

describe('files', () => {
  it("serves a job's definition and template from its active version, else its draft, and nothing else", async () => {
    const id = await readyJob();
    const fromDraft = await (await filesRoute.GET(get(`/api/jobs/${id}/files`), params({ id }))).json();
    expect(fromDraft).toEqual({ id, name: `${library}/${queue}`, definitionYaml: yaml, templateHtml: template });

    expect((await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'v1' }), params({ id }))).status).toBe(201);
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { template: '<p>draft</p>', formats: ['pdf'] } } }), params({ id }));
    const fromVersion = await (await filesRoute.GET(get(`/api/jobs/${id}/files`), params({ id }))).json();
    expect(fromVersion.templateHtml).toBe(template);

    expect((await filesRoute.GET(get('/api/jobs/not-a-job/files'), params({ id: 'not-a-job' }))).status).toBe(404);
    expect((await filesRoute.GET(appRequest(`/api/jobs/${id}/files`), params({ id }))).status).toBe(401);
  });
});

describe('runs', () => {
  it('needs a saved version', async () => {
    const id = await readyJob();
    const response = await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
    expect(response.status).toBe(409);
  });

  it('lists no runs for a job id that is not a UUID, not every job\'s', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
    const mine = await (await runsRoute.GET(get(`/api/jobs/${id}/runs`), params({ id }))).json();
    expect(mine.runs).toHaveLength(1);
    const other = await (await runsRoute.GET(get('/api/jobs/foo/runs'), params({ id: 'foo' }))).json();
    expect(other).toEqual({ runs: [], next: null });
  });

  it('runs a file: captures it, delivers one PDF per document, holds it and logs every step', async () => {
    const spies = spyConsole();
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const response = await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
    expect(response.status).toBe(201);
    const [run] = (await response.json()).runs as RunView[];

    expect(run).toMatchObject({ status: 'success', version: 1, trigger: 'manual', documents: 6, error: null });
    expect(run!.steps.map((s) => [s.step, s.ok])).toEqual([
      ['capture', true],
      ['extract', true],
      ['render', true],
      ['deliver', true],
      ['finish', true],
    ]);
    expect(run!.outputs.map((o) => o.name)).toContain('invoice-260101.pdf');
    expect(run!.outputs).toHaveLength(6);
    expect(fake().actions()).toEqual(['holdSpooledFile']);
    expect(await db().select().from(watchSeen)).toHaveLength(1);

    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${run!.outputs[0]!.id}`), params({ id: run!.id, file: run!.outputs[0]!.id }));
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF_BYTES);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('makes HTML files next to the PDFs, and serves them sandboxed', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { template, formats: ['html', 'pdf'] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('success');
    expect(run!.outputs).toHaveLength(12);
    expect(run!.outputs.slice(0, 2).map((o) => o.name)).toEqual(['invoice-260101.pdf', 'invoice-260101.html']);
    expect(run!.steps.find((s) => s.step === 'render')?.note).toBe('6 PDFs and 6 HTML files');
    const html = run!.outputs.find((o) => o.name === 'invoice-260101.html')!;
    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${html.id}?inline=1`), params({ id: run!.id, file: html.id }));
    expect(file.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(file.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(await file.text()).toContain('260101');
  });

  it('prints uploaded assets as data URIs in the preview, the preview PDF and runs', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await db().insert(assets).values({ name: 'logo', contentType: 'image/png', size: png.length, content: png });
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    const withLogo = template.replace('<body>', `<body><img src="{{ asset('logo') }}" alt="">`);
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { template: withLogo, formats: ['html', 'pdf'] } } }), params({ id }));

    const preview = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(preview.html).toContain(`<img src="${uri}" alt="">`);
    const missing = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: "{{ asset('stamp') }}" }), params({ id }))).json();
    expect(missing.template.error).toContain('There is no asset named "stamp"');

    expect((await previewPdf.POST(post(`/api/jobs/${id}/preview-pdf`, {}), params({ id }))).status).toBe(200);
    expect(renderPdf.mock.calls[0]![0]).toContain(uri);

    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.status).toBe('success');
    const html = run!.outputs.find((o) => o.name === 'invoice-260101.html')!;
    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${html.id}?inline=1`), params({ id: run!.id, file: html.id }));
    expect(await file.text()).toContain(uri);
  });

  it('makes only HTML when PDF is off', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { template, formats: ['html'] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.outputs.map((o) => o.contentType)).toEqual(Array(6).fill('text/html; charset=utf-8'));
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('moves or deletes the file, or leaves it, as the version says', async () => {
    for (const [finish, expected] of [
      [{ action: 'move', queue: { library: 'MYLIB', name: 'ARCHIVE' } }, ['moveSpooledFile']],
      [{ action: 'delete', queue: null }, ['deleteSpooledFile']],
      [{ action: 'none', queue: null }, []],
    ] as const) {
      connections.clear();
      const id = await readyJob();
      await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { finish } }), params({ id }));
      await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
      await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
      expect(fake().actions()).toEqual(expected);
    }
  });

  it('fails a run for a file that is gone, without touching anything', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const failing = await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [{ ...sample.splf, number: 999 }] }), params({ id }));
    const [run] = (await failing.json()).runs as RunView[];
    expect(run!.status).toBe('failed');
    expect(run!.steps.at(-1)).toMatchObject({ step: 'capture', ok: false });
    expect(run!.error).toMatch(/not found/);
    expect(fake().actions()).toEqual([]);
  });

  it('skips a file the definition is not for, without touching it, and remembers it', async () => {
    const id = await readyJob();
    const other = yaml.replace(/^match:\n(?:  .*\n)*/m, '').replace(/^source: text$/m, 'match:\n  splf: OTHERFILE\nsource: text');
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: other } } }), params({ id }));
    const preview = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(preview.mismatch).toEqual([`spooled file name is ${sample.splf.name}, not OTHERFILE`]);
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('skipped');
    expect(run!.error).toBe(`Skipped: the definition is not for this file (spooled file name is ${sample.splf.name}, not OTHERFILE).`);
    expect(run!.steps.map((s) => [s.step, s.ok, s.note])).toEqual([
      ['capture', true, `${sample.pages.length} pages`],
      ['extract', true, 'Not for this definition'],
    ]);
    expect(run!.outputs).toEqual([]);
    expect(fake().actions()).toEqual([]);
    expect(await db().select().from(watchSeen)).toHaveLength(1);
    const skipped = await (await runLog.GET(get('/api/runs?status=skipped'))).json();
    expect(skipped.runs).toHaveLength(1);
  });

  it('gives a warning when the file cannot be held after delivery', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    fake().failures.set('holdSpooledFile', Object.assign(new Error('Not authorized to spooled file.'), { name: 'ConnectionError', code: 'authority' }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.status).toBe('warning');
    expect(run!.outputs).toHaveLength(6);
    expect(run!.error).toMatch(/Delivered, but the spooled file was not handled/);
  });

  it('lists and filters the job log', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
    await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [{ ...sample.splf, number: 999 }] }), params({ id }));

    const all = await (await runLog.GET(get('/api/runs'))).json();
    expect(all.runs).toHaveLength(2);
    expect(all.runs[0].seq).toBeGreaterThan(all.runs[1].seq);
    const failed = await (await runLog.GET(get('/api/runs?status=failed'))).json();
    expect(failed.runs.map((r: RunView) => r.status)).toEqual(['failed']);
    const page = await (await runLog.GET(get('/api/runs?limit=1'))).json();
    expect(page.runs).toHaveLength(1);
    expect(page.next).toBe(all.runs[0].seq);
    const older = await (await runLog.GET(get(`/api/runs?limit=1&before=${page.next}`))).json();
    expect(older.runs[0].id).toBe(all.runs[1].id);
    const none = await (await runLog.GET(get('/api/runs?from=2999-01-01T00:00:00Z'))).json();
    expect(none.runs).toEqual([]);
    expect(await db().select({ id: runOutputs.id }).from(runOutputs)).toHaveLength(6);
    expect(await db().select({ id: runs.id }).from(runs)).toHaveLength(2);
  });
});
