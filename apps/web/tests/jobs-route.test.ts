import { CarboneError, type HtmlRender } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assets, jobs, jobVersions, queueHealth, runOutputs, runs, watchSeen } from '@/lib/server/db/schema';
import type { JobDetail, JobSummary, RunView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { fakeCarbone, fakeRenderer, PDF_BYTES } from './helpers/carbone';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, connections, params, spyConsole } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const jobsRoute = await import('@/app/api/jobs/route');
const jobRoute = await import('@/app/api/jobs/[id]/route');
const previewSample = await import('@/app/api/jobs/[id]/preview-sample/route');
const renderRoute = await import('@/app/api/jobs/[id]/render/route');
const previewFile = await import('@/app/api/jobs/[id]/preview-file/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');
const restore = await import('@/app/api/jobs/[id]/versions/[n]/restore/route');
const activate = await import('@/app/api/jobs/[id]/versions/[n]/activate/route');
const runsRoute = await import('@/app/api/jobs/[id]/runs/route');
const filesRoute = await import('@/app/api/jobs/[id]/files/route');
const runLog = await import('@/app/api/runs/route');
const fileRoute = await import('@/app/api/runs/[id]/files/[file]/route');

const { setDocumentRenderer } = await import('@/lib/server/documents');
const { CARBONE_NOT_CONNECTED } = await import('@/lib/server/render');
const { getRendering } = await import('@/lib/server/rendering');

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
  await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml }, render: { outputs: [output()] } } }), params({ id }));
  const captured = await previewSample.POST(post(`/api/jobs/${id}/preview-sample`, { splf: sample.splf }), params({ id }));
  expect(captured.status).toBe(201);
  return id;
}

/** An output of the job, the first unless given an id and label. */
const output = ({ id = 'main', label = 'Document', source = template as string | null, formats = ['pdf'] as ('pdf' | 'html')[] } = {}) => ({
  id,
  label,
  template: { kind: 'html' as const, source },
  formats,
});

/** A second output: the invoice lines as HTML. */
const LINES = output({ id: 'lines', label: 'Lines', source: '<ul><li>{d.doc.lines[i].line}</li><li>{d.doc.lines[i+1]}</li></ul>', formats: ['html'] });

/** What the fake Carbone was sent for its n-th render. */
const sent = (n = 0) => fakeCarbone.mock.calls[n]![0];

/** The fake IBM i connection behind the test server. */
const fake = (): FakeConnection => connections.get('ibmi.example.com|DEMOUSER')!;

beforeEach(async () => {
  await resetTables(db());
  connections.clear();
  auth = await signedIn();
  serverId = await insertServer();
});

describe('jobs', () => {
  it('lists a job whose spec no longer reads as broken, with the reason, and the others as usual', async () => {
    const good = await newJob();
    const oldVersion = await newJob();
    const oldDraft = await newJob();
    const [row] = await db().select().from(jobs).where(eq(jobs.id, oldVersion));
    // A version saved by an older release, with a trigger this one does not know.
    await db().insert(jobVersions).values({ jobId: oldVersion, number: 1, spec: { ...row!.draft, trigger: { mode: 'sometimes' } } as never });
    await db().update(jobs).set({ activeVersion: 1, name: 'Old version' }).where(eq(jobs.id, oldVersion));
    await db().update(jobs).set({ draft: { source: 'MYLIB/INVOICES' } as never, name: 'Old draft' }).where(eq(jobs.id, oldDraft));

    const response = await jobsRoute.GET(get('/api/jobs'));
    expect(response.status).toBe(200);
    const list = (await response.json()).jobs as JobSummary[];
    const byId = new Map(list.map((j) => [j.id, j]));
    expect(byId.get(good)).toMatchObject({ broken: null, source: { library, queue } });
    expect(byId.get(oldVersion)).toMatchObject({
      broken: expect.stringMatching(/^The active version cannot be read \(trigger\.mode: .+\)\. Save the job as a new version\.$/),
      mode: 'manual',
      // Shown from the draft meanwhile.
      source: { library, queue },
    });
    expect(byId.get(oldDraft)).toMatchObject({ broken: expect.stringMatching(/^The draft cannot be read \(source: /), source: { library: '', queue: '' } });
  });

  it('says on the job why its queue is polled instead of watched in real time', async () => {
    const id = await newJob();
    expect((await job(id)).realtimeError).toBeNull();
    const since = new Date('2026-10-18T08:00:00Z');
    await db().insert(queueHealth).values({ serverId, library, name: queue, realtimeError: 'CPF9801 Data queue not found', realtimeErrorSince: since });
    expect((await job(id)).realtimeError).toEqual({ error: 'CPF9801 Data queue not found', since: since.toISOString() });
  });

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

    const unsaved = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: '<p>{d.doc.invoiceNo}</p>' }), params({ id }))).json();
    expect(unsaved.html).toContain('<p>260101</p>');
    // Nunjucks is not converted: the check lists it and nothing is sent.
    const old = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: '<p>{{ doc.invoiceNo }}</p>' }), params({ id }))).json();
    expect(old.errors.join('\n')).toMatch(/is Nunjucks/);
    expect(old.html).toBeUndefined();
    const starter = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: null }), params({ id }))).json();
    expect(starter.template.generated).toBe(true);
  });

  it("renders the draft template of the output asked for, the first by default", async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output(), LINES] } } }), params({ id }));
    const first = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(first.html).toContain('<title>Invoice 260101</title>');
    const lines = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { outputId: 'lines' }), params({ id }))).json();
    expect(lines.html).toContain('<ul><li>');
    const unknown = await renderRoute.POST(post(`/api/jobs/${id}/render`, { outputId: 'nope' }), params({ id }));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe('The job has no output nope.');
    // An output added a moment ago renders with the editor's text before its draft is saved.
    const unsaved = await renderRoute.POST(post(`/api/jobs/${id}/render`, { outputId: 'new', html: null }), params({ id }));
    expect(unsaved.status).toBe(200);

    const pdf = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { outputId: 'lines' }), params({ id }));
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="invoice-260101-lines.pdf"');
    const pdfCall = fakeCarbone.mock.calls.map((call) => call[0]).find((input) => input.format === 'pdf')!;
    expect(pdfCall.template).toMatch(/^<ul><li>/);
    expect((await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { outputId: 'nope' }), params({ id }))).status).toBe(404);
  });

  it('downloads a preview PDF named after the output name, and reports problems', async () => {
    const id = await readyJob();
    const response = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { document: 1 }), params({ id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="invoice-260102.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    // The HTML is rendered and checked first, then the PDF, with the page width for the paper rule.
    expect(sent(1)).toMatchObject({ format: 'pdf', pageWidth: sample.attributes.pageWidth });
    expect(sent(1).data.doc.invoiceNo).toBe('260102');

    expect((await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { document: 50 }), params({ id }))).status).toBe(400);
    const broken = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { html: '<p>{d.doc.invoiceNumber}</p>' }), params({ id }));
    expect(broken.status).toBe(422);
    expect((await broken.json()).templateErrors).toEqual(['Template line 1: {d.doc.invoiceNumber} is not in the data. Did you mean {d.doc.invoiceNo}?']);
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
  it("serves a job's definition and outputs from its active version, else its draft, and nothing else", async () => {
    const id = await readyJob();
    const fromDraft = await (await filesRoute.GET(get(`/api/jobs/${id}/files`), params({ id }))).json();
    expect(fromDraft).toEqual({
      id,
      name: `${library}/${queue}`,
      definitionYaml: yaml,
      outputs: [{ id: 'main', label: 'Document', formats: ['pdf'], kind: 'html', templateHtml: template, fileId: null }],
    });

    expect((await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'v1' }), params({ id }))).status).toBe(201);
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output({ source: '<p>draft</p>' }), LINES] } } }), params({ id }));
    const fromVersion = await (await filesRoute.GET(get(`/api/jobs/${id}/files`), params({ id }))).json();
    expect(fromVersion.outputs.map((o: { templateHtml: string }) => o.templateHtml)).toEqual([template]);

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
    expect(run!.files.map((f) => f.name)).toContain('invoice-260101.pdf');
    expect(run!.files).toHaveLength(6);
    expect(fake().actions()).toEqual(['holdSpooledFile']);
    expect(await db().select().from(watchSeen)).toHaveLength(1);

    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${run!.files[0]!.id}`), params({ id: run!.id, file: run!.files[0]!.id }));
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF_BYTES);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('makes HTML files next to the PDFs, and serves them sandboxed', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output({ formats: ['html', 'pdf'] })] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('success');
    expect(run!.files).toHaveLength(12);
    expect(run!.files.slice(0, 2).map((f) => f.name)).toEqual(['invoice-260101.pdf', 'invoice-260101.html']);
    expect(run!.steps.find((s) => s.step === 'render')?.note).toBe('6 PDFs and 6 HTML files');
    const html = run!.files.find((f) => f.name === 'invoice-260101.html')!;
    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${html.id}?inline=1`), params({ id: run!.id, file: html.id }));
    expect(file.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(file.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(await file.text()).toContain('260101');
  });

  it('prints uploaded assets as data URIs in the preview, the preview PDF and runs', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await db().insert(assets).values({ name: 'logo', contentType: 'image/png', size: png.length, content: png });
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    const withLogo = template.replace('<body>', `<body><img src="{asset('logo')}" alt="">`);
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output({ source: withLogo, formats: ['html', 'pdf'] })] } } }), params({ id }));

    const preview = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(preview.html).toContain(`<img src="${uri}" alt="">`);
    const missing = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: "{asset('stamp')}" }), params({ id }))).json();
    expect(missing.template.error).toContain('There is no asset named "stamp"');
    expect(missing.template.problems).toEqual([{ line: 1, message: expect.stringContaining('There is no asset named "stamp"') }]);

    fakeCarbone.mockClear();
    expect((await previewFile.POST(post(`/api/jobs/${id}/preview-file`, {}), params({ id }))).status).toBe(200);
    expect(sent(1).format).toBe('pdf');
    expect(sent(1).template).toContain(`<img src="{asset('logo')}" alt="">`);
    expect((sent(1) as HtmlRender).asset?.('logo')).toBe(uri);

    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.status).toBe('success');
    const html = run!.files.find((f) => f.name === 'invoice-260101.html')!;
    const file = await fileRoute.GET(get(`/api/runs/${run!.id}/files/${html.id}?inline=1`), params({ id: run!.id, file: html.id }));
    expect(await file.text()).toContain(uri);
  });

  it("makes every output's files, names the others after their label and groups them by output", async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output(), LINES] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('success');
    expect(run!.files).toHaveLength(12);
    expect(run!.files.map((f) => f.output)).toEqual([...Array(6).fill('Document'), ...Array(6).fill('Lines')]);
    expect(run!.files[0]).toMatchObject({ name: 'invoice-260101.pdf', contentType: 'application/pdf' });
    expect(run!.files[6]).toMatchObject({ name: 'invoice-260101-lines.html', contentType: 'text/html; charset=utf-8' });
    expect(run!.steps.find((s) => s.step === 'render')?.note).toBe('6 PDFs and 6 HTML files');
  });

  it("fails the run with the output's name when its template has an error", async () => {
    const id = await readyJob();
    await jobRoute.PATCH(
      patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output(), output({ id: 'lines', label: 'Lines', source: "<p>{asset('stamp')}</p>" })] } } }),
      params({ id }),
    );
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('failed');
    expect(run!.error).toBe(
      'The "Lines" output\'s template has 1 problem. Line 1: There is no asset named "stamp". Upload it on the Assets page, or fix the name in {asset(\'stamp\')}.',
    );
    expect(run!.files).toEqual([]);
    expect(fake().actions()).toEqual([]);
  });

  it('says Carbone is not connected in the preview, and fails a run with what to do when it cannot be reached', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    setDocumentRenderer(null);
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND carbone' } });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(refused)));
    try {
      const preview = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
      expect(preview.carbone).toEqual({ error: CARBONE_NOT_CONNECTED });
      expect(preview.html).toBeUndefined();
      expect(preview.extract.documents).toHaveLength(6);
      expect((await previewFile.POST(post(`/api/jobs/${id}/preview-file`, {}), params({ id }))).status).toBe(503);

      const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
      expect(run!.status).toBe('failed');
      expect(run!.error).toBe(
        'Could not reach Carbone at http://carbone:4000. Check that the Carbone service runs and that the URL in Settings, under Rendering, is right.',
      );
      expect(run!.steps.find((step) => step.step === 'render')).toMatchObject({ ok: false, detail: 'ENOTFOUND: getaddrinfo ENOTFOUND carbone' });
      expect(fake().actions()).toEqual([]);
      // Noted, so Settings and the setup checklist show it before the next check.
      expect((await getRendering()).check).toMatchObject({ ok: false, error: run!.error });
    } finally {
      vi.unstubAllGlobals();
      setDocumentRenderer(fakeRenderer);
    }
  });

  it('fails a run with the line of each problem the tag check finds, before anything is sent to Carbone', async () => {
    const id = await readyJob();
    const typo = template.replace('{d.doc.customerName}', '{d.doc.customerNam}');
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output({ source: typo })] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.status).toBe('failed');
    expect(run!.error).toMatch(/^The "Document" output's template has 1 problem\. Line \d+: \{d\.doc\.customerNam\} is not in the data\. Did you mean \{d\.doc\.customerName\}\?$/);
    expect(fakeCarbone).not.toHaveBeenCalled();
  });

  it('keeps Carbone\'s own text with a template error Carbone finds', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    fakeCarbone.mockRejectedValueOnce(new CarboneError('template', 'A loop in the template has no end row.', { detail: 'The marker {d.doc.lines[i].item} has no corresponding [i+1]' }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.error).toBe('The "Document" output, document 1: A loop in the template has no end row.');
    expect(run!.steps.find((step) => step.step === 'render')?.detail).toBe('The marker {d.doc.lines[i].item} has no corresponding [i+1]');
  });

  it('makes only HTML when PDF is off', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { outputs: [output({ formats: ['html'] })] } } }), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.files.map((f) => f.contentType)).toEqual(Array(6).fill('text/html; charset=utf-8'));
    expect(fakeCarbone.mock.calls.map((call) => call[0].format)).toEqual(Array(6).fill('html'));
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
      await versions.POST(post(`/api/jobs/${id}/versions`, { confirmDelete: finish.action === 'delete' }), params({ id }));
      await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }));
      expect(fake().actions()).toEqual(expected);
    }
  });

  it('asks to confirm a version that starts deleting spooled files, and saves nothing until then', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { finish: { action: 'delete', queue: null } } }), params({ id }));

    const refused = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: `Spooled files on ${library}/${queue} will be deleted from the IBM i after their documents are delivered.`,
      confirm: 'delete',
      queue: `${library}/${queue}`,
    });
    const [before] = await db().select().from(jobs).where(eq(jobs.id, id));
    expect(before!.activeVersion).toBe(1);
    expect((await (await versions.GET(get(`/api/jobs/${id}/versions`), params({ id }))).json()).versions).toHaveLength(1);

    // Saving without making it active needs no confirmation; making it active later does.
    const saved = await (await versions.POST(post(`/api/jobs/${id}/versions`, { activate: false }), params({ id }))).json();
    expect(saved.number).toBe(2);
    expect((await activate.POST(post(`/api/jobs/${id}/versions/2/activate`), params({ id, n: '2' }))).status).toBe(409);
    const activated = await activate.POST(post(`/api/jobs/${id}/versions/2/activate`, { confirmDelete: true }), params({ id, n: '2' }));
    expect(activated.status).toBe(200);
    expect((await activated.json()).activeVersion).toBe(2);

    // Once a deleting version is active, the next deleting version needs no confirmation.
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, { note: 'still deletes' }), params({ id }))).status).toBe(201);
  });

  it('asks to confirm Delete on the first version too', async () => {
    const id = await readyJob();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { finish: { action: 'delete', queue: null } } }), params({ id }));
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }))).status).toBe(409);
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, { confirmDelete: true }), params({ id }))).status).toBe(201);
  });

  it('activates without a body, as before', async () => {
    const id = await readyJob();
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    await versions.POST(post(`/api/jobs/${id}/versions`, { activate: false }), params({ id }));
    const response = await activate.POST(appRequest(`/api/jobs/${id}/versions/2/activate`, { method: 'POST', headers: auth }), params({ id, n: '2' }));
    expect(response.status).toBe(200);
    expect((await response.json()).activeVersion).toBe(2);
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
    expect(run!.files).toEqual([]);
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
    expect(run!.files).toHaveLength(6);
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
