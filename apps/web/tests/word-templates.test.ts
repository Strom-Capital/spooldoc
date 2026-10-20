import { parseDefinition, readDocx, starterDocx } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobs, templateFiles, user } from '@/lib/server/db/schema';
import type { JobDetail, RunView, TemplateFileDetails, TemplateFileView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { fakeCarbone, fakeRenderer, PDF_BYTES } from './helpers/carbone';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer, insertUser } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const jobsRoute = await import('@/app/api/jobs/route');
const jobRoute = await import('@/app/api/jobs/[id]/route');
const previewSample = await import('@/app/api/jobs/[id]/preview-sample/route');
const renderRoute = await import('@/app/api/jobs/[id]/render/route');
const previewFile = await import('@/app/api/jobs/[id]/preview-file/route');
const uploadRoute = await import('@/app/api/jobs/[id]/template-files/route');
const starterRoute = await import('@/app/api/jobs/[id]/starter-docx/route');
const fileInfo = await import('@/app/api/template-files/[id]/route');
const fileBytes = await import('@/app/api/template-files/[id]/file/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');
const runsRoute = await import('@/app/api/jobs/[id]/runs/route');
const runFile = await import('@/app/api/runs/[id]/files/[file]/route');
const { setDocumentRenderer } = await import('@/lib/server/documents');
const { cleanUp } = await import('@/lib/server/retention');

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const { library, name: queue } = sample.attributes.queue;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The Word starter template of the invoice definition: a .docx whose tags all pass the check. */
const goodDocx = Buffer.from(await starterDocx(parseDefinition(yaml)));
/** A .docx with `{d.pg.invoiceNumber}`, which the invoice definition does not have. */
const badDocx = Buffer.from(await starterDocx(parseDefinition(yaml.replace('name: invoiceNo,', 'name: invoiceNumber,').replace('field: invoiceNo }', 'field: invoiceNumber }'))));

let auth: Record<string, string>;
let serverId: string;

const post = (path: string, body?: unknown) => appRequest(path, { method: 'POST', body: body ?? {}, headers: auth });
const patch = (path: string, body: unknown) => appRequest(path, { method: 'PATCH', body, headers: auth });
const get = (path: string) => appRequest(path, { headers: auth });

/** Upload a Word file for one template of the job. */
function upload(id: string, file: Buffer, fields: { templateId?: string; name?: string } = {}): Promise<Response> {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)]), fields.name ?? 'invoice.docx');
  form.set('templateId', fields.templateId ?? 'main');
  const request = new Request(`http://localhost:3000/api/jobs/${id}/template-files`, {
    method: 'POST',
    body: form,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', ...auth },
  });
  return uploadRoute.POST(request, params({ id }));
}

async function job(id: string): Promise<JobDetail> {
  return (await jobRoute.GET(get(`/api/jobs/${id}`), params({ id }))).json();
}

/** A job with the invoice definition, an HTML template making PDF and HTML, and the invoice sample as preview. */
async function readyJob(): Promise<string> {
  const response = await jobsRoute.POST(post('/api/jobs', { serverId, library, queue }));
  const { id } = (await response.json()) as { id: string };
  const templates = [{ id: 'main', name: 'Document', kind: 'html', source: null, formats: ['pdf', 'html'] }];
  await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml }, render: { templates } } }), params({ id }));
  expect((await previewSample.POST(post(`/api/jobs/${id}/preview-sample`, { splf: sample.splf }), params({ id }))).status).toBe(201);
  return id;
}

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  serverId = await insertServer();
  fakeCarbone.mockClear();
  setDocumentRenderer(fakeRenderer);
});

describe('uploading a Word template', () => {
  it('stores the file and makes the template a Word one, keeping the formats a Word template makes', async () => {
    const id = await readyJob();
    const response = await upload(id, goodDocx);
    expect(response.status).toBe(201);
    const saved = (await response.json()) as TemplateFileView;
    expect(saved).toMatchObject({ name: 'invoice.docx', size: goodDocx.length, madeBy: 'upload', previousId: null });
    expect((await job(id)).draft.render.templates[0]).toMatchObject({ kind: 'docx', fileId: saved.id, formats: ['pdf'] });

    const info = await fileInfo.GET(get(`/api/template-files/${saved.id}`), params({ id: saved.id }));
    expect(await info.json()).toEqual({ ...saved, previous: null });
    const bytes = await fileBytes.GET(get(`/api/template-files/${saved.id}/file`), params({ id: saved.id }));
    expect(bytes.headers.get('content-type')).toBe(DOCX);
    expect(bytes.headers.get('content-disposition')).toBe(`attachment; filename="invoice.docx"; filename*=UTF-8''invoice.docx`);
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(goodDocx);
  });

  it('keeps every upload: a new one is a new file, and the old one stays as it was', async () => {
    const id = await readyJob();
    const first = (await (await upload(id, goodDocx)).json()) as TemplateFileView;
    const second = (await (await upload(id, badDocx, { name: 'Lasku ÄÖ.docx' })).json()) as TemplateFileView;
    expect(second.id).not.toBe(first.id);
    expect(await db().select({ id: templateFiles.id }).from(templateFiles)).toHaveLength(2);
    const bytes = await fileBytes.GET(get(`/api/template-files/${second.id}/file`), params({ id: second.id }));
    expect(bytes.headers.get('content-disposition')).toBe(`attachment; filename="Lasku __.docx"; filename*=UTF-8''Lasku%20%C3%84%C3%96.docx`);
  });

  it('says why a file is not a Word template, and refuses a template the job does not have', async () => {
    const id = await readyJob();
    const html = await upload(id, Buffer.from('<html></html>'), { name: 'invoice.html' });
    expect(html.status).toBe(400);
    expect((await html.json()).error).toBe('file: The file is not a Word document. Save it in Word as a Word Document (.docx) and upload it again.');
    const doc = await upload(id, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
    expect((await doc.json()).error).toMatch(/Word 97-2003 document \(\.doc\)/);
    const nowhere = await upload(id, goodDocx, { templateId: 'lines' });
    expect(nowhere.status).toBe(404);
    expect((await nowhere.json()).error).toBe('templateId: The job has no template lines.');
    expect(await db().select().from(templateFiles)).toEqual([]);
    expect((await fileInfo.GET(get('/api/template-files/nope'), params({ id: 'nope' }))).status).toBe(404);
  });

  it('refuses formats the kind of template does not make', async () => {
    const id = await readyJob();
    const templates = [{ id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf', 'html'] }];
    const response = await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates } } }), params({ id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/A Word template makes PDF and DOCX files, not HTML\./);
  });
});

describe('previewing a Word template', () => {
  it('renders the uploaded file to a PDF with ICE and downloads the DOCX of a document', async () => {
    const id = await readyJob();
    const saved = (await (await upload(id, goodDocx)).json()) as TemplateFileView;
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(render.template).toEqual({ kind: 'docx', file: saved });
    expect(render.pdf).toBe(Buffer.from(PDF_BYTES).toString('base64'));
    expect(render.html).toBeUndefined();
    expect(fakeCarbone.mock.calls[0]![0]).toMatchObject({ kind: 'docx', format: 'pdf', converter: 'I' });
    expect(fakeCarbone.mock.calls[0]![0].data.pg.invoiceNo).toBe('260101');

    const docx = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { pageGroup: 1, format: 'docx' }), params({ id }));
    expect(docx.status).toBe(200);
    expect(docx.headers.get('content-type')).toBe(DOCX);
    expect(docx.headers.get('content-disposition')).toBe('attachment; filename="invoice-260102.docx"');
    expect(readDocx(new Uint8Array(await docx.arrayBuffer())).text).toContain('{d.pg.invoiceNo}');
    expect(fakeCarbone.mock.calls.at(-1)![0]).toMatchObject({ kind: 'docx', format: 'docx' });
    const pdf = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { format: 'pdf' }), params({ id }));
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('uses the Word starter template until a file is uploaded, also when the request names it before the draft is saved', async () => {
    const id = await readyJob();
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { docx: { fileId: null } }), params({ id }))).json();
    expect(render.template).toEqual({ kind: 'docx', file: null, generated: true });
    expect(render.pdf).toBeTruthy();
    const htmlDocx = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { format: 'docx' }), params({ id }));
    expect(htmlDocx.status).toBe(400);
    expect((await htmlDocx.json()).error).toBe('An HTML template makes PDF and HTML files.');
  });

  it('lists what the tag check finds by part, and sends nothing to Carbone', async () => {
    const id = await readyJob();
    await upload(id, badDocx);
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(render.template.problems).toEqual([{ part: 'body', message: '{d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?' }]);
    expect(render.errors).toEqual(['Template body: {d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?']);
    expect(render.pdf).toBeUndefined();
    expect(fakeCarbone).not.toHaveBeenCalled();
  });

  it('says when the file is gone', async () => {
    const id = await readyJob();
    const saved = (await (await upload(id, goodDocx)).json()) as TemplateFileView;
    await db().delete(templateFiles).where(eq(templateFiles.id, saved.id));
    const response = await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('The Word template file is gone. Upload the template again.');
    const save = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    expect(save.status).toBe(422);
    expect(JSON.stringify(await save.json())).toContain('Render: the Word file of the Document template is gone. Upload it again.');
  });

  it('downloads the Word starter template for the definition, or says to write one first', async () => {
    const id = await readyJob();
    const response = await starterRoute.POST(post(`/api/jobs/${id}/starter-docx`, {}), params({ id }));
    expect(response.headers.get('content-type')).toBe(DOCX);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="invoice-template.docx"');
    expect(readDocx(new Uint8Array(await response.arrayBuffer())).text).toContain('{d.pg.lines[i+1]}');
    const empty = await starterRoute.POST(post(`/api/jobs/${id}/starter-docx`, { yaml: '' }), params({ id }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe('Write a definition first: the starter template is made from it.');
  });
});

describe('runs with a Word template', () => {
  it('makes a DOCX and a PDF of each page group, named like other templates', async () => {
    const id = await readyJob();
    const saved = (await (await upload(id, goodDocx)).json()) as TemplateFileView;
    const templates = [{ id: 'main', name: 'Document', kind: 'docx', fileId: saved.id, formats: ['pdf', 'docx'] }];
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates } } }), params({ id }));
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }))).status).toBe(201);
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];

    expect(run!.status).toBe('success');
    expect(run!.files).toHaveLength(12);
    expect(run!.files.slice(0, 2).map((f) => [f.name, f.contentType])).toEqual([
      ['invoice-260101.pdf', 'application/pdf'],
      ['invoice-260101.docx', DOCX],
    ]);
    expect(run!.steps.find((s) => s.step === 'render')?.note).toBe('6 PDFs and 6 DOCX files');
    const calls = fakeCarbone.mock.calls.map((call) => call[0]);
    expect(calls.filter((c) => c.kind === 'docx' && c.format === 'docx')).toHaveLength(6);
    const docx = run!.files[1]!;
    const file = await runFile.GET(get(`/api/runs/${run!.id}/files/${docx.id}`), params({ id: run!.id, file: docx.id }));
    expect(file.headers.get('content-type')).toBe(DOCX);
  });

  it("fails the run with the template's name and the part of each problem", async () => {
    const id = await readyJob();
    await upload(id, badDocx);
    await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
    expect(run!.status).toBe('failed');
    expect(run!.error).toBe(`The "Document" template has 1 problem. Body: {d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?`);
    expect(fakeCarbone).not.toHaveBeenCalled();
  });
});

describe('template files', () => {
  const NOW = new Date('2026-10-18T12:00:00Z');
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  const insertFile = async (createdAt: Date) =>
    (await db().insert(templateFiles).values({ name: 't.docx', contentType: DOCX, size: 2, content: Buffer.from('PK'), createdAt }).returning())[0]!.id;

  it('never changes a file, but lets its uploader go', async () => {
    const userId = await insertUser();
    const [file] = await db().insert(templateFiles).values({ name: 't.docx', contentType: DOCX, size: 2, content: Buffer.from('PK'), createdBy: userId }).returning();
    const refused = { cause: expect.objectContaining({ message: expect.stringMatching(/cannot be changed/) }) };
    await expect(db().update(templateFiles).set({ name: 'other.docx' })).rejects.toMatchObject(refused);
    await expect(db().update(templateFiles).set({ content: Buffer.from('PK2') })).rejects.toMatchObject(refused);
    await expect(db().update(templateFiles).set({ madeBy: 'assistant' })).rejects.toMatchObject(refused);
    await expect(db().update(templateFiles).set({ previousId: file!.id })).rejects.toMatchObject(refused);
    await db().delete(user).where(eq(user.id, userId));
    expect(await db().select({ id: templateFiles.id, createdBy: templateFiles.createdBy }).from(templateFiles)).toEqual([{ id: file!.id, createdBy: null }]);
  });

  it('deletes files no draft or version uses once they are older than the retention', async () => {
    const id = await readyJob();
    const inDraft = await insertFile(daysAgo(100));
    const inVersion = await insertFile(daysAgo(100));
    const unused = await insertFile(daysAgo(100));
    const recent = await insertFile(daysAgo(1));
    const templates = (fileId: string) => [{ id: 'main', name: 'Document', kind: 'docx', fileId, formats: ['pdf'] }];
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates: templates(inVersion) } } }), params({ id }));
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }))).status).toBe(201);
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates: templates(inDraft) } } }), params({ id }));

    expect((await cleanUp(30, NOW))?.templateFiles).toBe(1);
    const left = (await db().select({ id: templateFiles.id }).from(templateFiles)).map((row) => row.id);
    expect(left.sort()).toEqual([inDraft, inVersion, recent].sort());
    expect(left).not.toContain(unused);
    // Deleting the job lets its files go too.
    await db().delete(jobs).where(eq(jobs.id, id));
    expect((await cleanUp(30, NOW))?.templateFiles).toBe(2);
  });

  it("keeps a file the agent replaced while the draft's file names it, and says so in the file's details", async () => {
    const id = await readyJob();
    const insert = async (values: Partial<typeof templateFiles.$inferInsert>) =>
      (await db().insert(templateFiles).values({ name: 't.docx', contentType: DOCX, size: 2, content: Buffer.from('PK'), createdAt: daysAgo(100), ...values }).returning())[0]!;
    const older = await insert({ name: 'older.docx' });
    const replaced = await insert({ name: 'mine.docx', previousId: older.id });
    const current = await insert({ name: 'mine.docx', madeBy: 'assistant', previousId: replaced.id });
    await jobRoute.PATCH(
      patch(`/api/jobs/${id}`, { draft: { render: { templates: [{ id: 'main', name: 'Document', kind: 'docx', fileId: current.id, formats: ['pdf'] }] } } }),
      params({ id }),
    );
    const details = (await (await fileInfo.GET(get(`/api/template-files/${current.id}`), params({ id: current.id }))).json()) as TemplateFileDetails;
    expect(details).toMatchObject({ id: current.id, madeBy: 'assistant', previousId: replaced.id, previous: { id: replaced.id, name: 'mine.docx', madeBy: 'upload' } });

    // The replaced file stays; the one before it, which no used file names, goes.
    expect((await cleanUp(30, NOW))?.templateFiles).toBe(1);
    expect((await db().select({ id: templateFiles.id }).from(templateFiles)).map((row) => row.id).sort()).toEqual([current.id, replaced.id].sort());

    // Once the draft uses the replaced file again, nothing names it, and the agent's file goes.
    await jobRoute.PATCH(
      patch(`/api/jobs/${id}`, { draft: { render: { templates: [{ id: 'main', name: 'Document', kind: 'docx', fileId: replaced.id, formats: ['pdf'] }] } } }),
      params({ id }),
    );
    expect((await cleanUp(30, NOW))?.templateFiles).toBe(1);
    const gone = (await (await fileInfo.GET(get(`/api/template-files/${replaced.id}`), params({ id: replaced.id }))).json()) as TemplateFileDetails;
    expect(gone).toMatchObject({ previousId: older.id, previous: null });
  });
});
