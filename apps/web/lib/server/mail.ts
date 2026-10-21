import 'server-only';

import { redact } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import nodemailer, { type NodemailerError, type SendMailOptions } from 'nodemailer';
import { SMTP_DEFAULT_PORT, type MailSettingsInput, type SmtpSecurity } from '../mail-config';
import type { MailView } from '../types';
import { getDb } from './db';
import { settings } from './db/schema';
import { decryptSecret, encryptSecret } from './secrets';
import { DEFAULT_SETTINGS } from './settings';

/** The mail server set in Settings, with the password decrypted. */
export interface MailServer {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | null;
  password: string | null;
  from: string;
  fromName: string | null;
}

/** What sends a message: Nodemailer's SMTP transport, or a stand-in in tests. */
export interface MailSender {
  sendMail(message: SendMailOptions): Promise<{ messageId?: string }>;
  close?(): void;
}

let override: ((server: MailServer) => MailSender) | null = null;

/** Send with something else than SMTP, for tests (Nodemailer's `jsonTransport`). Null goes back to SMTP. */
export function setMailSender(next: ((server: MailServer) => MailSender) | null): void {
  override = next;
}

const columns = {
  smtpHost: settings.smtpHost,
  smtpPort: settings.smtpPort,
  smtpSecurity: settings.smtpSecurity,
  smtpUser: settings.smtpUser,
  smtpPasswordEnc: settings.smtpPasswordEnc,
  mailFrom: settings.mailFrom,
  mailFromName: settings.mailFromName,
};

async function readRow() {
  const [row] = await getDb().select(columns).from(settings).where(eq(settings.id, 1));
  return row ?? { smtpHost: null, smtpPort: null, smtpSecurity: 'starttls', smtpUser: null, smtpPasswordEnc: null, mailFrom: null, mailFromName: null };
}

/** The mail server as Settings shows it, never with the password. */
export async function getMailView(): Promise<MailView> {
  const row = await readRow();
  const security = row.smtpSecurity as SmtpSecurity;
  return {
    host: row.smtpHost ?? '',
    port: row.smtpPort ?? SMTP_DEFAULT_PORT[security],
    security,
    user: row.smtpUser ?? '',
    hasPassword: row.smtpPasswordEnc !== null,
    from: row.mailFrom ?? '',
    fromName: row.mailFromName ?? '',
    configured: !!row.smtpHost && !!row.mailFrom,
  };
}

/** Save the mail server. An empty host removes it; the password is stored encrypted. */
export async function updateMail(change: MailSettingsInput): Promise<void> {
  const values: Partial<typeof settings.$inferInsert> = {
    smtpHost: change.host || null,
    smtpPort: change.host ? (change.port ?? SMTP_DEFAULT_PORT[change.security]) : null,
    smtpSecurity: change.security,
    smtpUser: change.user || null,
    mailFrom: change.from || null,
    mailFromName: change.fromName || null,
  };
  if (change.password === null || !change.user) values.smtpPasswordEnc = null;
  else if (change.password) values.smtpPasswordEnc = encryptSecret(change.password);
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
}

/**
 * The mail server set in Settings, or null when none is set.
 *
 * @throws Error when the saved password cannot be decrypted
 */
export async function mailServer(): Promise<MailServer | null> {
  const row = await readRow();
  if (!row.smtpHost || !row.mailFrom) return null;
  const security = row.smtpSecurity as SmtpSecurity;
  return {
    host: row.smtpHost,
    port: row.smtpPort ?? SMTP_DEFAULT_PORT[security],
    security,
    user: row.smtpUser,
    password: row.smtpPasswordEnc ? decryptSecret(row.smtpPasswordEnc, 'mail server password') : null,
    from: row.mailFrom,
    fromName: row.mailFromName,
  };
}

/** The From header: the name and the address. */
export function fromHeader(server: Pick<MailServer, 'from' | 'fromName'>): SendMailOptions['from'] {
  return server.fromName ? { name: server.fromName, address: server.from } : server.from;
}

/** Why no email can be sent: no mail server in Settings. */
export const NO_MAIL_SERVER = 'No mail server is set. Set one in Settings, under Mail server.';

/** A sender for the mail server: one SMTP connection per run or test, closed by `close`. */
export function mailSender(server: MailServer): MailSender {
  if (override) return override(server);
  return nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.security === 'tls',
    requireTLS: server.security === 'starttls',
    ignoreTLS: server.security === 'none',
    ...(server.user ? { auth: { user: server.user, pass: server.password ?? '' } } : {}),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

const CONNECTION_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EREQUIRETLS', 'EAUTH', 'ENOAUTH', 'EPROXY', 'ECONFIG']);

/** True when the error is the mail server or the connection, not this one email: the next email would fail too. */
export function stopsSending(error: unknown): boolean {
  const code = (error as NodemailerError | undefined)?.code;
  return typeof code === 'string' && CONNECTION_CODES.has(code);
}

/**
 * A mail error in plain words, with what to do next, and the server's own text as the
 * detail. Bad sign-in, a refused connection, a TLS mismatch, a message that is too large
 * and a rejected recipient each say what to check.
 */
export function mailErrorText(error: unknown, server: Pick<MailServer, 'host' | 'port'> & { password?: string | null }): { message: string; detail?: string } {
  const err = (error ?? {}) as NodemailerError & { errno?: string | number };
  const raw = err instanceof Error ? err.message : String(error);
  const detail = (err.response ?? raw).split('\n')[0]?.trim() || undefined;
  const at = `${server.host}:${server.port}`;
  const text = `${err.response ?? ''} ${raw}`.toLowerCase();
  let message: string;
  if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) {
    message = 'The mail server refused the sign-in. Check the user name and password in Settings, under Mail server, or use an app password.';
  } else if (err.code === 'ENOAUTH' || err.responseCode === 530) {
    message = 'The mail server wants a sign-in. Enter the user name and password in Settings, under Mail server.';
  } else if (err.code === 'EDNS' || /enotfound|eai_again/.test(text)) {
    message = `Could not find the mail server ${server.host}. Check the host in Settings, under Mail server.`;
  } else if (err.code === 'ETLS' || err.code === 'EREQUIRETLS' || /wrong version number|ssl routines|tls|certificate/.test(text)) {
    message = `Could not set up a secure connection with ${at}. Port 465 usually takes TLS and port 587 STARTTLS. Check Security in Settings, under Mail server.`;
  } else if (err.code === 'ETIMEDOUT' || /timed? ?out/.test(text)) {
    message = `The mail server ${at} did not answer in time. Check the host and port, and that a firewall lets the Spooldoc server reach it.`;
  } else if (err.code === 'ECONNECTION' || err.code === 'ESOCKET' || /econnrefused|econnreset/.test(text)) {
    message = `Could not connect to the mail server ${at}. Check the host and port, and that a firewall lets the Spooldoc server reach it.`;
  } else if (err.responseCode === 552 || /too (large|big)|size limit|exceeds.*size/.test(text)) {
    message = "The email is too large for the mail server. Attach fewer formats, or ask the mail server's administrator for a larger limit.";
  } else if (err.code === 'EENVELOPE' || (err.command === 'RCPT TO' && (err.responseCode ?? 0) >= 500)) {
    const who = err.rejected?.join(', ') ?? err.recipient;
    message = `The mail server refused ${who ? `the address ${who}` : 'an address'}. Check the address, or the job's To, Cc and Bcc.`;
  } else if (err.command === 'MAIL FROM' && (err.responseCode ?? 0) >= 500) {
    message = 'The mail server refused the From address. Use an address the mail server lets this user send from, in Settings, under Mail server.';
  } else {
    message = `The mail server did not take the email: ${(err.response ?? raw).split('\n')[0]}`;
  }
  // The server's text could echo the password back; it never leaves here.
  const secrets = server.password ? [server.password] : [];
  const clean = (text: string) => redact(text, secrets);
  return { message: clean(message), ...(detail && detail !== message ? { detail: clean(detail) } : {}) };
}

/**
 * Send a test email to `to` with the saved mail server.
 *
 * @throws Error with the reason in plain words when it cannot be sent, and the server's text as `detail`
 */
export async function sendTestEmail(to: string): Promise<void> {
  const server = await mailServer();
  if (!server) throw new Error(NO_MAIL_SERVER);
  const sender = mailSender(server);
  try {
    await sender.sendMail({
      from: fromHeader(server),
      to,
      subject: 'Test email from Spooldoc',
      text: 'This test email shows that Spooldoc can send email through the mail server in Settings.\n',
    });
  } catch (error) {
    const { message, detail } = mailErrorText(error, server);
    throw Object.assign(new Error(message), { detail });
  } finally {
    sender.close?.();
  }
}
