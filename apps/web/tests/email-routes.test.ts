import { eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailSpecSchema } from '@/lib/job-spec';
import { jobs, settings } from '@/lib/server/db/schema';
import { setMailSender } from '@/lib/server/mail';
import type { DestinationView, SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { fixtureText } from './helpers/fake-connection';
import { db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const settingsRoute = await import('@/app/api/settings/route');
const testRoute = await import('@/app/api/settings/mail/route');
const list = await import('@/app/api/destinations/route');
const one = await import('@/app/api/destinations/[id]/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');

let auth: Record<string, string>;
const mail = { host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' };
const put = (body: unknown) => settingsRoute.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }));

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

afterEach(() => setMailSender(null));

describe('the mail server in Settings', () => {
  it('is saved with the password encrypted, and never sends the password back', async () => {
    const response = await put({ mail });
    expect(response.status).toBe(200);
    const view = (await response.json()) as SettingsView;
    expect(view.mail).toEqual({ ...mail, password: undefined, hasPassword: true, configured: true });
    expect(JSON.stringify(view)).not.toContain('mail-Passw0rd');
    const [row] = await db().select({ enc: settings.smtpPasswordEnc }).from(settings);
    expect(row?.enc).toMatch(/^v1\./);
  });

  it('keeps the saved password when none is given, and removes it with null', async () => {
    await put({ mail });
    expect(((await (await put({ mail: { ...mail, password: undefined, fromName: 'Example' } })).json()) as SettingsView).mail.hasPassword).toBe(true);
    expect(((await (await put({ mail: { ...mail, password: null } })).json()) as SettingsView).mail.hasPassword).toBe(false);
  });

  it.each([
    [{ ...mail, from: 'not an address' }, 'Enter the From address, such as invoices@example.com'],
    [{ ...mail, from: '' }, 'Enter the From address, such as invoices@example.com'],
    [{ ...mail, host: 'smtp://smtp.example.com' }, 'Enter the host name alone, such as smtp.example.com'],
    [{ ...mail, port: 70000 }, 'Enter a port from 1 to 65535'],
  ])('refuses %j', async (body, message) => {
    const response = await put({ mail: body });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(`${message}.`);
  });

  it('sends a test email to the signed-in user', async () => {
    await put({ mail });
    const sent: SendMailOptions[] = [];
    const json = nodemailer.createTransport({ jsonTransport: true });
    setMailSender(() => ({ sendMail: async (message) => (sent.push(message), json.sendMail(message)) }));
    const response = await testRoute.POST(appRequest('/api/settings/mail', { method: 'POST', headers: auth }));
    expect(response.status).toBe(200);
    const { to } = await response.json();
    expect(sent).toMatchObject([{ to, subject: 'Test email from Spooldoc', from: { name: 'Example Co', address: 'invoices@example.com' } }]);
  });

  it('says what to do when the test email fails, with the server text as the detail', async () => {
    await put({ mail });
    setMailSender(() => ({
      sendMail: async () => {
        throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Bad credentials' });
      },
    }));
    const response = await testRoute.POST(appRequest('/api/settings/mail', { method: 'POST', headers: auth }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The mail server refused the sign-in. Check the user name and password in Settings, under Mail server, or use an app password.',
      detail: '535 5.7.8 Bad credentials',
    });
  });

  it('says to set a mail server before a test email', async () => {
    const response = await testRoute.POST(appRequest('/api/settings/mail', { method: 'POST', headers: auth }));
    expect((await response.json()).error).toBe('No mail server is set. Set one in Settings, under Mail server.');
  });
});

describe('email destinations', () => {
  const add = (body: unknown) => list.POST(appRequest('/api/destinations', { method: 'POST', body, headers: auth }));

  it('are added with a test address, and the test address can be taken out', async () => {
    const response = await add({ kind: 'email', name: 'Invoices by email', config: { testAddress: ' you@example.com ' } });
    expect(response.status).toBe(201);
    const view = (await response.json()) as DestinationView;
    expect(view).toMatchObject({ kind: 'email', name: 'Invoices by email', config: { testAddress: 'you@example.com' } });
    const changed = await one.PATCH(
      appRequest(`/api/destinations/${view.id}`, { method: 'PATCH', body: { config: { testAddress: '' } }, headers: auth }),
      params({ id: view.id }),
    );
    expect(((await changed.json()) as DestinationView).config).toEqual({ testAddress: null });
  });

  it('refuse a test address that is not one address, also on a change', async () => {
    const refused = await add({ kind: 'email', name: 'Invoices by email', config: { testAddress: 'a@example.com, b@example.com' } });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('Enter one address, such as you@example.com.');
    const view = (await (await add({ kind: 'email', name: 'Invoices by email', config: {} })).json()) as DestinationView;
    const changed = await one.PATCH(
      appRequest(`/api/destinations/${view.id}`, { method: 'PATCH', body: { config: { testAddress: 'nobody' } }, headers: auth }),
      params({ id: view.id }),
    );
    expect(changed.status).toBe(400);
    const ifs = (await (await add({ kind: 'ifs', name: 'Folder', config: { folder: '/home/docs' } })).json()) as DestinationView;
    const wrong = await one.PATCH(appRequest(`/api/destinations/${ifs.id}`, { method: 'PATCH', body: { config: { testAddress: null } }, headers: auth }), params({ id: ifs.id }));
    expect(wrong.status).toBe(400);
  });

  it('need To before a version is saved, and fields the definition has', async () => {
    const destination = (await (await add({ kind: 'email', name: 'Invoices by email', config: {} })).json()) as DestinationView;
    const jobId = await insertJob(await insertServer(), { extract: { definition: fixtureText('invoice', 'definition.yaml') } });
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    const save = async (email: unknown) => {
      await db()
        .update(jobs)
        .set({ draft: { ...job!.draft, destination: { destinationId: destination.id, email: emailSpecSchema.parse(email) } } })
        .where(eq(jobs.id, jobId));
      return versions.POST(appRequest(`/api/jobs/${jobId}/versions`, { method: 'POST', body: { note: '' }, headers: auth }), params({ id: jobId }));
    };
    const missing = await save({});
    expect(missing.status).toBe(422);
    expect(JSON.stringify(await missing.json())).toContain('Destination: Enter To, the address each email goes to.');
    const unknown = await save({ to: '{d.pg.emial}' });
    expect(JSON.stringify(await unknown.json())).toContain('Destination: To: {d.pg.emial} is not in the data.');
    expect((await save({ to: '{d.pg.customerNo}@example.com', subject: 'Invoice {d.pg.invoiceNo}' })).status).toBe(201);
  });
});
