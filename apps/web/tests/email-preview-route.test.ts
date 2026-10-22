import { beforeEach, describe, expect, it } from 'vitest';
import { emailDocuments, emailSpecSchema, emptySpec, type EmailSpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs } from '@/lib/server/db/schema';
import { storeSample } from '@/lib/server/samples';
import type { EmailPreviewView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const previewRoute = await import('@/app/api/jobs/[id]/email-preview/route');

type Templates = JobSpec['render']['templates'];
const invoice: Templates[number] = { id: 'main', name: 'Invoice', kind: 'html', source: null, formats: ['pdf'] };
const lines: Templates[number] = { id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['xlsx'] };
const wholePdf: Templates[number] = { id: 'main', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['pdf'] };

let auth: Record<string, string>;

/** A job with the invoice definition, the given templates, the invoice sample as preview, and an email destination. */
async function emailJob(templates: Templates): Promise<{ id: string; destinationId: string }> {
  const serverId = await insertServer();
  const sample = await storeSample(serverId, { sample: loadSample('invoice'), warnings: [] });
  const [destination] = await db().insert(destinations).values({ kind: 'email', name: 'Invoices by email', config: { testAddress: null } }).returning();
  const base = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: destination!.id });
  const draft: JobSpec = { ...base, extract: { definition: fixtureText('invoice', 'definition.yaml') }, render: { templates }, preview: { sampleId: sample.id } };
  const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft }).returning();
  return { id: job!.id, destinationId: destination!.id };
}

/** The preview of the email the request asks for. */
async function preview(job: { id: string; destinationId: string }, email: Partial<EmailSpec>, options: { pageGroup?: number; document?: 'splf' } = {}): Promise<EmailPreviewView> {
  const body = { email: emailSpecSchema.parse(email), destinationId: job.destinationId, ...options };
  const response = await previewRoute.POST(appRequest(`/api/jobs/${job.id}/email-preview`, { method: 'POST', body, headers: auth }), params({ id: job.id }));
  expect(response.status).toBe(200);
  return (await response.json()) as EmailPreviewView;
}

const text = (segments: { text: string }[]) => segments.map((segment) => segment.text).join('');

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('which emails a run sends', () => {
  it('sends the whole spooled file its own email only when Attach picks one of its formats', () => {
    expect(emailDocuments([invoice], ['pdf'])).toEqual({ pageGroups: true, spooledFile: false });
    expect(emailDocuments([invoice, lines], ['xlsx'])).toEqual({ pageGroups: false, spooledFile: true });
    expect(emailDocuments([invoice, lines], ['pdf', 'xlsx'])).toEqual({ pageGroups: true, spooledFile: true });
    expect(emailDocuments([invoice, lines], [])).toEqual({ pageGroups: true, spooledFile: false });
  });
});

describe('the email preview', () => {
  it('shows only the email of the whole spooled file when page groups get none, filled in from the spooled file', async () => {
    const job = await emailJob([wholePdf]);
    const view = await preview(job, { to: 'orders@example.com', subject: 'Invoices {d.splf.name}', attach: ['pdf'] }, { pageGroup: 2 });
    expect(view).toMatchObject({ pageGroup: null, pageGroups: 6, pageGroupEmails: false, spooledFileEmail: true, document: 'spdinvoice', problems: [] });
    expect(text(view.to)).toBe('orders@example.com');
    expect(text(view.subject)).toBe('Invoices SPDINVOICE');
    expect(view.attachments).toEqual([{ name: 'spdinvoice.pdf', format: 'pdf' }]);
    expect(view.html).toContain('Your document is attached.');
    expect(view.notices).toEqual(['One email for the whole spooled file. Page groups get no email, since Attach picks only its files.']);
    expect(view.fields.length).toBeGreaterThan(0);
    expect(view.fields.every((field) => field.path.startsWith('splf.'))).toBe(true);
  });

  it('names a page group that shares its name with an earlier one as a run does, with a number', async () => {
    const job = await emailJob([invoice]);
    const [row] = await db().select().from(jobs);
    const definition = fixtureText('invoice', 'definition.yaml').replace('name: "invoice-{d.pg.invoiceNo}"', 'name: "invoice"');
    await db().update(jobs).set({ draft: { ...row!.draft, extract: { definition } } });
    const view = await preview(job, { to: 'orders@example.com', attach: ['pdf'] }, { pageGroup: 2 });
    expect(view.document).toBe('invoice-3');
    expect(text(view.subject)).toBe('invoice-3');
    expect(view.attachments).toEqual([{ name: 'invoice-3.pdf', format: 'pdf' }]);
  });

  it('names the attachments of a page group that shares its name as the run names its files, with two templates', async () => {
    const cover: Templates[number] = { id: 'cover', name: 'Cover', kind: 'html', source: null, formats: ['pdf'] };
    const job = await emailJob([invoice, cover]);
    const [row] = await db().select().from(jobs);
    const definition = fixtureText('invoice', 'definition.yaml').replace('name: "invoice-{d.pg.invoiceNo}"', 'name: "invoice"');
    await db().update(jobs).set({ draft: { ...row!.draft, extract: { definition } } });
    const view = await preview(job, { to: 'orders@example.com', attach: ['pdf'] }, { pageGroup: 1 });
    // A run names them invoice-2.pdf and invoice-cover-2.pdf: the -2 goes on the file name, after the template's.
    expect(view.attachments).toEqual([
      { name: 'invoice-2.pdf', format: 'pdf' },
      { name: 'invoice-cover-2.pdf', format: 'pdf' },
    ]);
  });

  it('shows the email of a page group, or the whole spooled file when asked, when the run sends both', async () => {
    const job = await emailJob([invoice, lines]);
    const email = { to: 'orders@example.com', attach: ['pdf', 'xlsx'] } satisfies Partial<EmailSpec>;
    const group = await preview(job, email, { pageGroup: 0 });
    expect(group).toMatchObject({ pageGroup: 0, pageGroupEmails: true, spooledFileEmail: true, document: 'invoice-260101', notices: [] });
    expect(group.attachments).toEqual([{ name: 'invoice-260101.pdf', format: 'pdf' }]);
    expect(group.fields.some((field) => field.path.startsWith('pg.'))).toBe(true);

    const whole = await preview(job, email, { pageGroup: 5, document: 'splf' });
    expect(whole).toMatchObject({ pageGroup: null, document: 'spdinvoice', notices: [] });
    expect(whole.attachments).toEqual([{ name: 'spdinvoice-lines.xlsx', format: 'xlsx' }]);
  });

  it('gives the whole spooled file the written message even with a message template, and says so', async () => {
    const job = await emailJob([invoice, lines]);
    const view = await preview(job, { to: 'orders@example.com', body: 'All invoices of the run.', bodyTemplateId: 'main', attach: ['xlsx'] });
    expect(view.pageGroup).toBeNull();
    expect(view.html).toContain('All invoices of the run.');
    expect(view.bodyError).toBeNull();
    expect(view.notices).toContain(
      'The message template makes the email of each page group only. This email has the written message: pick Text written here under Message from to change it.',
    );
  });

  it('names the whole spooled file in the problems of its email, not a page group', async () => {
    const job = await emailJob([wholePdf]);
    const view = await preview(job, { to: '{d.pg.customerNo}@example.com', attach: ['pdf'] });
    expect(view.problems[0]).toMatch(/^Whole spooled file: \{d\.pg\.customerNo\} is not in the data/);
  });

  it('shows the page group when asked for the whole spooled file but the run sends it no email', async () => {
    const job = await emailJob([invoice]);
    const view = await preview(job, { to: 'orders@example.com', attach: ['pdf'] }, { pageGroup: 1, document: 'splf' });
    expect(view).toMatchObject({ pageGroup: 1, pageGroupEmails: true, spooledFileEmail: false, document: 'invoice-260102' });
  });
});
