import { parseDefinition, readXlsx, starterXlsx } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runFiles, templateFiles } from '@/lib/server/db/schema';
import type { JobDetail, RunView, TemplateFileDetails, TemplateFileView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { fakeCarbone, fakeRenderer, PDF_BYTES, sentPageGroup } from './helpers/carbone';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const jobsRoute = await import('@/app/api/jobs/route');
const jobRoute = await import('@/app/api/jobs/[id]/route');
const previewSample = await import('@/app/api/jobs/[id]/preview-sample/route');
const renderRoute = await import('@/app/api/jobs/[id]/render/route');
const previewFile = await import('@/app/api/jobs/[id]/preview-file/route');
const uploadRoute = await import('@/app/api/jobs/[id]/template-files/route');
const starterRoute = await import('@/app/api/jobs/[id]/starter/route');
const fileInfo = await import('@/app/api/template-files/[id]/route');
const fileBytes = await import('@/app/api/template-files/[id]/file/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');
const runsRoute = await import('@/app/api/jobs/[id]/runs/route');
const { setDocumentRenderer } = await import('@/lib/server/documents');

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const def = parseDefinition(yaml);
const { library, name: queue } = sample.attributes.queue;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The Excel starter templates of the invoice definition: their tags all pass the check. */
const flatXlsx = Buffer.from(await starterXlsx(def, 'splf'));
const pageGroupXlsx = Buffer.from(await starterXlsx(def, 'pageGroup'));
/** An Excel starter with `{d.pgs[i].invoiceNumber}`, which the invoice definition does not have. */
const badXlsx = Buffer.from(await starterXlsx(parseDefinition(yaml.replace('name: invoiceNo,', 'name: invoiceNumber,').replace('field: invoiceNo }', 'field: invoiceNumber }'))));

let auth: Record<string, string>;
let serverId: string;

const post = (path: string, body?: unknown) => appRequest(path, { method: 'POST', body: body ?? {}, headers: auth });
const patch = (path: string, body: unknown) => appRequest(path, { method: 'PATCH', body, headers: auth });
const get = (path: string) => appRequest(path, { headers: auth });

/** Upload a file for one template of the job, as the template's panel does. */
function upload(id: string, file: Buffer, fields: { templateId?: string; name?: string; kind?: string } = {}): Promise<Response> {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)]), fields.name ?? 'lines.xlsx');
  form.set('templateId', fields.templateId ?? 'main');
  if (fields.kind) form.set('kind', fields.kind);
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

/** A job with the invoice definition, the given templates (an Excel starter making XLSX by default), and the invoice sample as preview. */
async function readyJob(templates: unknown[] = [{ id: 'main', name: 'Lines', kind: 'xlsx', fileId: null, formats: ['xlsx'] }]): Promise<string> {
  const response = await jobsRoute.POST(post('/api/jobs', { serverId, library, queue }));
  const { id } = (await response.json()) as { id: string };
  const saved = await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml }, render: { templates } } }), params({ id }));
  expect(saved.status).toBe(200);
  expect((await previewSample.POST(post(`/api/jobs/${id}/preview-sample`, { splf: sample.splf }), params({ id }))).status).toBe(201);
  return id;
}

/** Save the draft as a version and run the sample with it. */
async function runOnce(id: string): Promise<RunView> {
  expect((await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }))).status).toBe(201);
  const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
  return run!;
}

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  serverId = await insertServer();
  fakeCarbone.mockClear();
  setDocumentRenderer(fakeRenderer);
});

describe('an Excel template in the job', () => {
  it('holds the whole spooled file by default, and makes XLSX and PDF only', async () => {
    const id = await readyJob();
    expect((await job(id)).draft.render.templates[0]).toEqual({ id: 'main', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['xlsx'] });
    const templates = [{ id: 'main', name: 'Lines', kind: 'xlsx', fileId: null, formats: ['xlsx', 'html'] }];
    const response = await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates } } }), params({ id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/An Excel template makes XLSX and PDF files, not HTML\./);
  });
});

describe('uploading an Excel template', () => {
  it('stores the file as an Excel workbook, and checks it as the template\'s kind', async () => {
    const id = await readyJob();
    const response = await upload(id, flatXlsx);
    expect(response.status).toBe(201);
    const saved = (await response.json()) as TemplateFileView;
    expect(saved).toMatchObject({ name: 'lines.xlsx', size: flatXlsx.length, madeBy: 'upload' });
    expect((await job(id)).draft.render.templates[0]).toMatchObject({ kind: 'xlsx', fileId: saved.id, scope: 'splf', formats: ['xlsx'] });
    const bytes = await fileBytes.GET(get(`/api/template-files/${saved.id}/file`), params({ id: saved.id }));
    expect(bytes.headers.get('content-type')).toBe(XLSX);
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(flatXlsx);

    // A Word file is not an Excel template, and an old .xls is named as one.
    const docx = await upload(id, Buffer.from(await (await import('@spooldoc/core')).starterDocx(def)), { name: 'invoice.docx' });
    expect(docx.status).toBe(400);
    expect((await docx.json()).error).toBe('file: The file is a zip file, but not an Excel workbook: it has no xl/workbook.xml. The file is not an Excel workbook. Save it in Excel as an Excel Workbook (.xlsx) and upload it again.');
    const xls = await upload(id, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), { name: 'lines.xls' });
    expect((await xls.json()).error).toMatch(/Excel 97-2003 workbook \(\.xls\)\. Save it in Excel as an Excel Workbook/);
    expect(await db().select({ id: templateFiles.id }).from(templateFiles)).toHaveLength(1);
  });

  it('makes an HTML template an Excel one when the upload says so, and a Word template refuses a workbook', async () => {
    const id = await readyJob([
      { id: 'main', name: 'Document', kind: 'html', source: null, formats: ['pdf', 'html'] },
      { id: 'letter', name: 'Letter', kind: 'docx', fileId: null, formats: ['pdf'] },
    ]);
    const saved = (await (await upload(id, flatXlsx, { kind: 'xlsx' })).json()) as TemplateFileView;
    expect((await job(id)).draft.render.templates[0]).toMatchObject({ kind: 'xlsx', fileId: saved.id, scope: 'splf', formats: ['pdf'] });
    const word = await upload(id, flatXlsx, { templateId: 'letter', kind: 'xlsx' });
    expect(word.status).toBe(400);
    expect((await word.json()).error).toMatch(/^file: The file is a zip file, but not a Word document/);
    expect((await upload(id, flatXlsx, { templateId: 'letter', kind: 'pptx' })).status).toBe(400);
  });

  it('says a file the agent made is its own, and names the file it replaced', async () => {
    const id = await readyJob();
    const uploaded = (await (await upload(id, flatXlsx)).json()) as TemplateFileView;
    const [made] = await db()
      .insert(templateFiles)
      .values({ name: 'lines.xlsx', contentType: XLSX, size: flatXlsx.length, content: flatXlsx, madeBy: 'assistant', previousId: uploaded.id })
      .returning();
    await jobRoute.PATCH(
      patch(`/api/jobs/${id}`, { draft: { render: { templates: [{ id: 'main', name: 'Lines', kind: 'xlsx', fileId: made!.id, scope: 'splf', formats: ['xlsx'] }] } } }),
      params({ id }),
    );
    const details = (await (await fileInfo.GET(get(`/api/template-files/${made!.id}`), params({ id: made!.id }))).json()) as TemplateFileDetails;
    expect(details).toMatchObject({ id: made!.id, madeBy: 'assistant', previousId: uploaded.id, previous: { id: uploaded.id, name: 'lines.xlsx', madeBy: 'upload' } });
  });
});

describe('previewing an Excel template', () => {
  it('renders the whole spooled file to one PDF with LibreOffice, and downloads its XLSX named after the spooled file', async () => {
    const id = await readyJob();
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { pageGroup: 2 }), params({ id }))).json();
    expect(render.template).toEqual({ kind: 'xlsx', file: null, scope: 'splf', generated: true, noPageSetup: [] });
    expect(render.pdf).toBe(Buffer.from(PDF_BYTES).toString('base64'));
    const sent = fakeCarbone.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: 'xlsx', format: 'pdf' });
    // Every page group, and no page group of its own.
    expect(sentPageGroup(sent)).toBeUndefined();
    expect((sent.data as { pgs: unknown[] }).pgs).toHaveLength(6);

    const xlsx = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { format: 'xlsx' }), params({ id }));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toBe(XLSX);
    expect(xlsx.headers.get('content-disposition')).toBe(`attachment; filename="${sample.splf.name.toLowerCase()}.xlsx"`);
    expect(readXlsx(new Uint8Array(await xlsx.arrayBuffer())).text).toContain('{d.pgs[i].invoiceNo}');
    const docx = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { format: 'docx' }), params({ id }));
    expect((await docx.json()).error).toBe('An Excel template makes XLSX and PDF files.');
  });

  it('renders one page group for a template of page groups, as the request names it before the draft is saved', async () => {
    const id = await readyJob();
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { xlsx: { fileId: null, scope: 'pageGroup' }, pageGroup: 1 }), params({ id }))).json();
    expect(render.template).toMatchObject({ kind: 'xlsx', scope: 'pageGroup', generated: true });
    expect(sentPageGroup(fakeCarbone.mock.calls[0]![0])?.invoiceNo).toBe('260102');
    const xlsx = await previewFile.POST(post(`/api/jobs/${id}/preview-file`, { xlsx: { fileId: null, scope: 'pageGroup' }, pageGroup: 1, format: 'xlsx' }), params({ id }));
    expect(xlsx.headers.get('content-disposition')).toBe('attachment; filename="invoice-260102.xlsx"');
    expect(readXlsx(new Uint8Array(await xlsx.arrayBuffer())).text).toContain('{d.pg.invoiceNo}');
  });

  it('lists what the tag check finds by sheet and cell, says which sheets have no page setup, and sends nothing to Carbone', async () => {
    const id = await readyJob();
    await upload(id, badXlsx);
    const render = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(render.template.problems).toEqual([{ sheet: 'Lines', ref: 'A2', message: '{d.pgs[i].invoiceNumber} is not in the data. Did you mean {d.pgs[i].invoiceNo}?' }]);
    expect(render.errors).toEqual(['Template Lines!A2: {d.pgs[i].invoiceNumber} is not in the data. Did you mean {d.pgs[i].invoiceNo}?']);
    expect(render.pdf).toBeUndefined();
    expect(fakeCarbone).not.toHaveBeenCalled();

    // A page group starter read as the whole spooled file: its d.pg tags are problems.
    await upload(id, pageGroupXlsx);
    const wrongScope = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(wrongScope.template.problems[0]).toMatchObject({ sheet: 'Invoice', ref: 'B3', message: expect.stringMatching(/read one page group, but this template gets every page group/) });
  });

  it('downloads the Excel starter for the scope, or says to write a definition first', async () => {
    const id = await readyJob();
    const flat = await starterRoute.POST(post(`/api/jobs/${id}/starter`, { kind: 'xlsx' }), params({ id }));
    expect(flat.headers.get('content-type')).toBe(XLSX);
    expect(flat.headers.get('content-disposition')).toBe('attachment; filename="invoice-template.xlsx"');
    expect(readXlsx(new Uint8Array(await flat.arrayBuffer())).text).toContain('{d.pgs[i+1].lines[i+1]}');
    const one = await starterRoute.POST(post(`/api/jobs/${id}/starter`, { kind: 'xlsx', scope: 'pageGroup' }), params({ id }));
    expect(readXlsx(new Uint8Array(await one.arrayBuffer())).text).toContain('{d.pg.lines[i+1]}');
    const word = await starterRoute.POST(post(`/api/jobs/${id}/starter`, {}), params({ id }));
    expect(word.headers.get('content-type')).toBe(DOCX);
    const empty = await starterRoute.POST(post(`/api/jobs/${id}/starter`, { kind: 'xlsx', yaml: '' }), params({ id }));
    expect(empty.status).toBe(400);
  });

  it('says when the file is gone, before a render and when the version is saved', async () => {
    const id = await readyJob();
    const saved = (await (await upload(id, flatXlsx)).json()) as TemplateFileView;
    await db().delete(templateFiles).where(eq(templateFiles.id, saved.id));
    const response = await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('The template file is gone. Upload the template again.');
    const save = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    expect(save.status).toBe(422);
    expect(JSON.stringify(await save.json())).toContain('Render: the Excel file of the Lines template is gone. Upload it again.');
  });
});

describe('runs with an Excel template', () => {
  it('makes one XLSX and PDF of the whole spooled file, named after it, with no page group', async () => {
    const id = await readyJob([
      { id: 'main', name: 'Document', kind: 'html', source: null, formats: ['pdf'] },
      { id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, formats: ['xlsx', 'pdf'] },
    ]);
    const run = await runOnce(id);
    expect(run.status).toBe('success');
    const name = sample.splf.name.toLowerCase();
    expect(run.files.map((f) => [f.name, f.contentType])).toEqual([
      ...['260101', '260102', '260103', '260104', '260105', '260106'].map((no) => [`invoice-${no}.pdf`, 'application/pdf']),
      [`${name}-lines.pdf`, 'application/pdf'],
      [`${name}-lines.xlsx`, XLSX],
    ]);
    expect(run.steps.find((s) => s.step === 'render')?.note).toBe('7 PDFs and 1 XLSX file');
    const excel = fakeCarbone.mock.calls.map((call) => call[0]).filter((c) => c.kind === 'xlsx');
    expect(excel.map((c) => c.format)).toEqual(['pdf', 'xlsx']);
    // Worked out once from the template: the starter has formulas.
    expect(excel.find((c) => c.format === 'xlsx')).toMatchObject({ hardRefresh: true });
    expect((excel[0]!.data as { pgs: unknown[] }).pgs).toHaveLength(6);
    const rows = await db().select({ name: runFiles.name, pageGroupIndex: runFiles.pageGroupIndex }).from(runFiles).where(eq(runFiles.runId, run.id));
    expect(rows.find((row) => row.name === `${name}-lines.xlsx`)?.pageGroupIndex).toBeNull();
    expect(rows.find((row) => row.name === 'invoice-260101.pdf')?.pageGroupIndex).toBe(0);
  });

  it('makes one XLSX per page group for a template of page groups', async () => {
    const id = await readyJob([{ id: 'main', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'pageGroup', formats: ['xlsx'] }]);
    const run = await runOnce(id);
    expect(run.status).toBe('success');
    expect(run.files.map((f) => f.name)).toEqual(['260101', '260102', '260103', '260104', '260105', '260106'].map((no) => `invoice-${no}.xlsx`));
    expect(run.steps.find((s) => s.step === 'render')?.note).toBe('6 XLSX files');
  });

  it("fails the run with the template's name and the sheet and cell of each problem", async () => {
    const id = await readyJob();
    await upload(id, badXlsx);
    const run = await runOnce(id);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('The "Lines" template has 1 problem. Lines!A2: {d.pgs[i].invoiceNumber} is not in the data. Did you mean {d.pgs[i].invoiceNo}?');
    expect(fakeCarbone).not.toHaveBeenCalled();
  });
});
