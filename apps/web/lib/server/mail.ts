import 'server-only';

import { redact } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import nodemailer, { type NodemailerError, type SendMailOptions } from 'nodemailer';
import { mailSettingsSchema, SMTP_DEFAULT_PORT, type MailSenderKind, type MailSettingsInput, type SmtpSecurity } from '../mail-config';
import type { MailView } from '../types';
import { getDb } from './db';
import { settings } from './db/schema';
import { GraphMailError, graphErrorMessage, graphSendMail } from './graph-mail';
import { decryptSecret, encryptSecret } from './secrets';
import { DEFAULT_SETTINGS } from './settings';

/** The SMTP server set in Settings, with the password decrypted. */
export interface SmtpServer {
  sender: 'smtp';
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | null;
  password: string | null;
  from: string;
  fromName: string | null;
}

/** Microsoft 365 as set in Settings, with the client secret decrypted. `from` is the mailbox it sends from. */
export interface M365Server {
  sender: 'm365';
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
  fromName: string | null;
}

/** How email is sent, as set in Settings. */
export type MailServer = SmtpServer | M365Server;

/** What sends a message: Nodemailer's SMTP transport, Microsoft Graph, or a stand-in in tests. */
export interface MailSender {
  sendMail(message: SendMailOptions): Promise<{ messageId?: string }>;
  close?(): void;
}

let override: ((server: MailServer) => MailSender) | null = null;

/** Send with something else than SMTP or Graph, for tests (Nodemailer's `jsonTransport`). Null goes back to the real senders. */
export function setMailSender(next: ((server: MailServer) => MailSender) | null): void {
  override = next;
}

const columns = {
  mailSender: settings.mailSender,
  smtpHost: settings.smtpHost,
  smtpPort: settings.smtpPort,
  smtpSecurity: settings.smtpSecurity,
  smtpUser: settings.smtpUser,
  smtpPasswordEnc: settings.smtpPasswordEnc,
  m365TenantId: settings.m365TenantId,
  m365ClientId: settings.m365ClientId,
  m365SecretEnc: settings.m365SecretEnc,
  mailFrom: settings.mailFrom,
  mailFromName: settings.mailFromName,
};

interface MailRow {
  mailSender: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string;
  smtpUser: string | null;
  smtpPasswordEnc: string | null;
  m365TenantId: string | null;
  m365ClientId: string | null;
  m365SecretEnc: string | null;
  mailFrom: string | null;
  mailFromName: string | null;
}

const EMPTY_ROW: MailRow = {
  mailSender: 'smtp',
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: 'starttls',
  smtpUser: null,
  smtpPasswordEnc: null,
  m365TenantId: null,
  m365ClientId: null,
  m365SecretEnc: null,
  mailFrom: null,
  mailFromName: null,
};

async function readRow(): Promise<MailRow> {
  const [row] = await getDb().select(columns).from(settings).where(eq(settings.id, 1));
  return row ?? EMPTY_ROW;
}

/** True when the row has what its sender needs to send. */
function isConfigured(row: MailRow): boolean {
  if (!row.mailFrom) return false;
  if (row.mailSender === 'm365') return !!row.m365TenantId && !!row.m365ClientId && row.m365SecretEnc !== null;
  return !!row.smtpHost;
}

/** The mail server as Settings shows it, never with the password or the client secret. */
export async function getMailView(): Promise<MailView> {
  const row = await readRow();
  const security = row.smtpSecurity as SmtpSecurity;
  return {
    sender: row.mailSender as MailSenderKind,
    host: row.smtpHost ?? '',
    port: row.smtpPort ?? SMTP_DEFAULT_PORT[security],
    security,
    user: row.smtpUser ?? '',
    hasPassword: row.smtpPasswordEnc !== null,
    tenantId: row.m365TenantId ?? '',
    clientId: row.m365ClientId ?? '',
    hasClientSecret: row.m365SecretEnc !== null,
    from: row.mailFrom ?? '',
    fromName: row.mailFromName ?? '',
    configured: isConfigured(row),
  };
}

/**
 * Why the change cannot be saved, and the field it is about. Null when it can.
 *
 * - Microsoft 365 with a tenant and no client secret, given or saved.
 * - An SMTP host, port or user name that is not the saved one, with the saved password
 *   kept. The saved password is only ever sent to the server, port and user it was
 *   entered for.
 */
export async function mailChangeProblem(input: MailSettingsInput): Promise<{ message: string; path: string[] } | null> {
  const change = mailSettingsSchema.parse(input);
  if (change.sender === 'smtp') {
    const keepsPassword = change.password === undefined || change.password === '';
    if (!change.host || !change.user || !keepsPassword) return null;
    const row = await readRow();
    const port = change.port ?? SMTP_DEFAULT_PORT[change.security];
    const savedPort = row.smtpPort ?? SMTP_DEFAULT_PORT[row.smtpSecurity as SmtpSecurity];
    const targetChanged = change.host.toLowerCase() !== row.smtpHost?.toLowerCase() || port !== savedPort || change.user !== row.smtpUser;
    return row.smtpPasswordEnc !== null && targetChanged ? { message: 'Enter the password again for the new server or user.', path: ['mail', 'password'] } : null;
  }
  if (!change.tenantId || change.clientSecret) return null;
  const row = await readRow();
  return row.m365SecretEnc === null || change.clientSecret === null
    ? { message: 'Enter the client secret, the value from Certificates & secrets in the app registration.', path: ['mail', 'clientSecret'] }
    : null;
}

/**
 * Save the mail server. Only the picked sender's fields change, so the other's stay for
 * when it is picked again. An empty host, or an empty tenant ID, turns email off. The
 * password and the client secret are stored encrypted.
 */
export async function updateMail(input: MailSettingsInput): Promise<void> {
  const change = mailSettingsSchema.parse(input);
  const values: Partial<typeof settings.$inferInsert> = { mailSender: change.sender, mailFrom: change.from || null, mailFromName: change.fromName || null };
  if (change.sender === 'smtp') {
    values.smtpHost = change.host || null;
    values.smtpPort = change.host ? (change.port ?? SMTP_DEFAULT_PORT[change.security]) : null;
    values.smtpSecurity = change.security;
    values.smtpUser = change.user || null;
    if (change.password === null || !change.user) values.smtpPasswordEnc = null;
    else if (change.password) values.smtpPasswordEnc = encryptSecret(change.password);
  } else {
    values.m365TenantId = change.tenantId || null;
    values.m365ClientId = change.tenantId ? change.clientId || null : null;
    if (change.clientSecret === null || !change.tenantId) values.m365SecretEnc = null;
    else if (change.clientSecret) values.m365SecretEnc = encryptSecret(change.clientSecret);
  }
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
}

/**
 * How email is sent, as set in Settings, or null when it is not set.
 *
 * @throws Error when the saved password or client secret cannot be decrypted
 */
export async function mailServer(): Promise<MailServer | null> {
  const row = await readRow();
  if (!isConfigured(row)) return null;
  if (row.mailSender === 'm365') {
    return {
      sender: 'm365',
      tenantId: row.m365TenantId!,
      clientId: row.m365ClientId!,
      clientSecret: decryptSecret(row.m365SecretEnc!, 'Microsoft 365 client secret'),
      from: row.mailFrom!,
      fromName: row.mailFromName,
    };
  }
  const security = row.smtpSecurity as SmtpSecurity;
  return {
    sender: 'smtp',
    host: row.smtpHost!,
    port: row.smtpPort ?? SMTP_DEFAULT_PORT[security],
    security,
    user: row.smtpUser,
    password: row.smtpPasswordEnc ? decryptSecret(row.smtpPasswordEnc, 'mail server password') : null,
    from: row.mailFrom!,
    fromName: row.mailFromName,
  };
}

/** The secret of the mail server, the password or the client secret, to keep out of every error and log. */
export function mailSecrets(server: MailServer): string[] {
  const secret = server.sender === 'm365' ? server.clientSecret : server.password;
  return secret ? [secret] : [];
}

/** The From header: the name and the address. */
export function fromHeader(server: Pick<MailServer, 'from' | 'fromName'>): SendMailOptions['from'] {
  return server.fromName ? { name: server.fromName, address: server.from } : server.from;
}

/** Why no email can be sent: no mail server in Settings. */
export const NO_MAIL_SERVER = 'No mail server is set. Set one in Settings, under Mail server.';

/**
 * A sender for the mail server: one SMTP connection per run or test, closed by `close`,
 * or Microsoft Graph as the mailbox in From, with a cached token. The SMTP connection is
 * pooled, so a run signs in once instead of once per email. A refused recipient resets the
 * session and the connection goes on; other errors close it, and the next email opens a
 * new one. After 100 emails the pool opens a fresh connection.
 */
export function mailSender(server: MailServer): MailSender {
  if (override) return override(server);
  if (server.sender === 'm365') {
    const account = { tenantId: server.tenantId, clientId: server.clientId, clientSecret: server.clientSecret, mailbox: server.from };
    return { sendMail: (message) => graphSendMail(account, message) };
  }
  return nodemailer.createTransport({
    pool: true,
    maxConnections: 1,
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

/** True when the error is the mail server, the sign-in or the connection, not this one email: the next email would fail too. */
export function stopsSending(error: unknown): boolean {
  if (error instanceof GraphMailError) return error.stops;
  const code = (error as NodemailerError | undefined)?.code;
  return typeof code === 'string' && CONNECTION_CODES.has(code);
}

/**
 * A mail error in plain words, with what to do next, and the server's own text as the
 * detail. Bad sign-in, a refused connection, a TLS mismatch, a message that is too large
 * and a rejected recipient each say what to check, and so does each Microsoft 365 error,
 * from a wrong tenant ID to throttling. The password or client secret never shows.
 */
export function mailErrorText(error: unknown, server: MailServer): { message: string; detail?: string } {
  const secrets = mailSecrets(server);
  const clean = (text: string) => redact(text, secrets);
  let message: string;
  let detail: string | undefined;
  if (server.sender === 'm365') {
    if (error instanceof GraphMailError) {
      message = graphErrorMessage(error, { tenantId: server.tenantId, clientId: server.clientId, mailbox: server.from });
      detail = error.detail;
    } else {
      message = `Microsoft 365 did not take the email: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    ({ message, detail } = smtpErrorText(error, server));
  }
  // The server's text could echo the secret back; it never leaves here.
  return { message: clean(message), ...(detail && detail !== message ? { detail: clean(detail) } : {}) };
}

function smtpErrorText(error: unknown, server: SmtpServer): { message: string; detail?: string } {
  const err = (error ?? {}) as NodemailerError & { errno?: string | number };
  const raw = err instanceof Error ? err.message : String(error);
  const detail = (err.response ?? raw).split('\n')[0]?.trim() || undefined;
  const at = `${server.host}:${server.port}`;
  const text = `${err.response ?? ''} ${raw}`.toLowerCase();
  // The error's text is read for connection errors only, with no reply from the server: a refused recipient can mention TLS or a timeout too.
  const connection = err.responseCode === undefined;
  // An error at RCPT TO is about that recipient, not the message or the connection.
  const recipient = err.command === 'RCPT TO' || (err.code === 'EENVELOPE' && err.command !== 'MAIL FROM');
  const tooLarge = /\b5\.3\.4\b|too (large|big)|size limit|exceeds.*size|message size/.test(text);
  const who = err.rejected?.join(', ') ?? err.recipient;
  let message: string;
  if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) {
    message = 'The mail server refused the sign-in. Check the user name and password in Settings, under Mail server, or use an app password.';
  } else if (err.code === 'ENOAUTH' || err.responseCode === 530) {
    message = 'The mail server wants a sign-in. Enter the user name and password in Settings, under Mail server.';
  } else if (err.code === 'EDNS' || (connection && /enotfound|eai_again/.test(text))) {
    message = `Could not find the mail server ${server.host}. Check the host in Settings, under Mail server.`;
  } else if (err.code === 'ETLS' || err.code === 'EREQUIRETLS' || (connection && /wrong version number|ssl routines|tls|certificate/.test(text))) {
    message = `Could not set up a secure connection with ${at}. Port 465 usually takes TLS and port 587 STARTTLS. Check Security in Settings, under Mail server.`;
  } else if (err.code === 'ETIMEDOUT' || (connection && /timed? ?out/.test(text))) {
    message = `The mail server ${at} did not answer in time. Check the host and port, and that a firewall lets the Spooldoc server reach it.`;
  } else if (err.code === 'ECONNECTION' || err.code === 'ESOCKET' || (connection && /econnrefused|econnreset/.test(text))) {
    message = `Could not connect to the mail server ${at}. Check the host and port, and that a firewall lets the Spooldoc server reach it.`;
  } else if (recipient && ((err.responseCode === 552 && !tooLarge) || /\b5\.2\.2\b|mailbox (is )?full|quota/.test(text))) {
    message = `The mailbox of ${who ?? 'a recipient'} is full, so the mail server did not take the email. Send it again later, or ask the recipient to make room.`;
  } else if (err.responseCode === 552 || tooLarge) {
    message = "The email is too large for the mail server. Attach fewer formats, or ask the mail server's administrator for a larger limit.";
  } else if (recipient && (err.code === 'EENVELOPE' || (err.responseCode ?? 0) >= 500)) {
    message = `The mail server refused ${who ? `the address ${who}` : 'an address'}. Check the address, or the job's To, Cc and Bcc.`;
  } else if (err.command === 'MAIL FROM' && (err.responseCode ?? 0) >= 500) {
    message = 'The mail server refused the From address. Use an address the mail server lets this user send from, in Settings, under Mail server.';
  } else {
    message = `The mail server did not take the email: ${(err.response ?? raw).split('\n')[0]}`;
  }
  return { message, ...(detail ? { detail } : {}) };
}

/**
 * Send a test email to `to` with the saved mail server or Microsoft 365.
 *
 * @throws Error with the reason in plain words when it cannot be sent, and the service's text as `detail`
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
      text:
        server.sender === 'm365'
          ? 'This test email shows that Spooldoc can send email through Microsoft 365 with the settings under Mail server.\n'
          : 'This test email shows that Spooldoc can send email through the mail server in Settings.\n',
    });
  } catch (error) {
    const { message, detail } = mailErrorText(error, server);
    throw Object.assign(new Error(message), { detail });
  } finally {
    sender.close?.();
  }
}
