import 'server-only';

import { createHash } from 'node:crypto';
import type { SendMailOptions } from 'nodemailer';
import type { Address } from 'nodemailer/lib/mailer';
import addressparser from 'nodemailer/lib/addressparser';
import { retryAfterSeconds } from './http';
import { log } from './log';

/** What Spooldoc signs in to Microsoft 365 with, and the mailbox it sends from. */
export interface M365Account {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The mailbox every email is sent from: the From address. */
  mailbox: string;
}

/**
 * Where the token and Graph requests go. `SPOOLDOC_MICROSOFT_URL` points both at one
 * stand-in server, for tests and checks only, so nothing reaches Microsoft.
 */
export function microsoftUrls(): { login: string; graph: string } {
  const standIn = process.env.SPOOLDOC_MICROSOFT_URL?.trim().replace(/\/+$/, '');
  if (!standIn) return { login: 'https://login.microsoftonline.com', graph: 'https://graph.microsoft.com' };
  if (warnedStandIn !== standIn) {
    log.warn('SPOOLDOC_MICROSOFT_URL is set: Microsoft 365 email goes to this stand-in, not to Microsoft', { url: standIn });
    warnedStandIn = standIn;
  }
  return { login: standIn, graph: standIn };
}

let warnedStandIn: string | null = null;

/** The largest file Graph takes inside one sendMail request: 3 MB. A larger one needs an upload session. */
export const GRAPH_FILE_LIMIT = 3 * 1024 * 1024;
/** The largest sendMail request Graph takes: 4 MB, with the files in base64. */
export const GRAPH_REQUEST_LIMIT = 4 * 1024 * 1024;
/** The longest Retry-After Spooldoc waits for when Microsoft 365 throttles, and how often it tries again. */
const MAX_WAIT_SECONDS = 60;
const MAX_RETRIES = 2;

/** What went wrong, so the message can say what to do. */
export type GraphProblem =
  | 'tenant'
  | 'client'
  | 'secret'
  | 'secret_expired'
  | 'sign_in'
  | 'consent'
  | 'policy'
  | 'denied'
  | 'mailbox'
  | 'throttled'
  | 'too_large'
  | 'recipient'
  | 'network'
  | 'service'
  | 'other';

/** The problems that would fail the next email too: the sign-in, the mailbox, the connection. */
const STOPS: ReadonlySet<GraphProblem> = new Set(['tenant', 'client', 'secret', 'secret_expired', 'sign_in', 'consent', 'policy', 'denied', 'mailbox', 'throttled', 'network', 'service']);

/** A failed Microsoft 365 send, with Microsoft's own text as the detail. */
export class GraphMailError extends Error {
  constructor(
    readonly problem: GraphProblem,
    /** Microsoft's own text, such as `AADSTS7000215: Invalid client secret provided.` */
    readonly detail: string | undefined,
    /** For `too_large`: the file, when one file is over the limit. */
    readonly file?: string,
    /** For `throttled`: the seconds Microsoft asked to wait. */
    readonly retryAfter?: number,
  ) {
    super(detail ?? problem);
    this.name = 'GraphMailError';
  }

  /** True when the next email would fail too, so the run stops sending. */
  get stops(): boolean {
    return STOPS.has(this.problem);
  }
}

/** Waits between tries when Microsoft 365 throttles. Tests replace it. */
export const graphTiming = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

interface CachedToken {
  token: string;
  /** When to stop using it: five minutes before it expires. */
  until: number;
  roles: string[] | null;
}

const tokens = new Map<string, CachedToken>();

/** Forget every cached token, for tests. */
export function clearGraphTokens(): void {
  tokens.clear();
}

const tokenKey = (account: M365Account) => createHash('sha256').update(`${account.tenantId}\n${account.clientId}\n${account.clientSecret}`).digest('hex');

/** The first line of Microsoft's text, without the trace and correlation IDs. */
const firstLine = (text: string | undefined): string | undefined => text?.split(/\r?\n/)[0]?.trim() || undefined;

/** The application permissions in an access token, or null when it cannot be read. */
function tokenRoles(token: string): string[] | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { roles?: unknown };
    return Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : [];
  } catch {
    return null;
  }
}

/** A fetch that fails as a GraphMailError when the network does, with the cause's code. */
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const text = [error instanceof Error ? error.message : String(error), cause?.code ?? cause?.message].filter(Boolean).join(': ');
    throw new GraphMailError('network', text);
  }
}

/** The kind of a token endpoint error, from its AADSTS code. */
function signInProblem(body: { error?: string; error_codes?: number[]; error_description?: string }): GraphProblem {
  const codes = new Set(body.error_codes ?? []);
  const text = body.error_description ?? '';
  const has = (code: number) => codes.has(code) || text.includes(`AADSTS${code}:`);
  if (has(90002) || has(900023) || has(90023)) return 'tenant';
  if (has(700016)) return 'client';
  if (has(7000222)) return 'secret_expired';
  if (has(7000215) || has(7000216)) return 'secret';
  if (has(7000229) || has(65001) || has(500011)) return 'consent';
  if (body.error === 'invalid_client') return 'secret';
  return 'sign_in';
}

/**
 * An access token for Microsoft Graph, from the client credentials flow. It is cached
 * until five minutes before it expires.
 *
 * @throws GraphMailError when the sign-in fails, with the AADSTS text as the detail
 */
export async function graphToken(account: M365Account): Promise<CachedToken> {
  const key = tokenKey(account);
  const cached = tokens.get(key);
  if (cached && cached.until > Date.now()) return cached;
  const response = await call(`${microsoftUrls().login}/${encodeURIComponent(account.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: account.clientId,
      client_secret: account.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number | string; error?: string; error_codes?: number[]; error_description?: string };
  if (!response.ok || !body.access_token) {
    const detail = firstLine(body.error_description) ?? `${response.status} ${response.statusText}`.trim();
    throw new GraphMailError(response.ok ? 'sign_in' : signInProblem(body), detail);
  }
  const seconds = Number(body.expires_in) || 3600;
  const token = { token: body.access_token, until: Date.now() + Math.max(seconds - 300, 30) * 1000, roles: tokenRoles(body.access_token) };
  tokens.set(key, token);
  return token;
}

/** A Graph recipient. */
interface Recipient {
  emailAddress: { address: string; name?: string };
}

/** The addresses of a Nodemailer address field, as Graph recipients. */
function recipients(field: unknown): Recipient[] {
  if (field === undefined || field === null || field === '') return [];
  if (Array.isArray(field)) return field.flatMap(recipients);
  const entries: { address?: string; name?: string }[] = typeof field === 'string' ? addressparser(field, { flatten: true }) : [field as Address];
  return entries.flatMap((entry) => (entry.address ? [{ emailAddress: { address: entry.address, ...(entry.name ? { name: entry.name } : {}) } }] : []));
}

/** A Graph file attachment. */
interface FileAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
  isInline?: boolean;
  contentId?: string;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

/**
 * The HTML with each data URI image as an inline attachment it points to with `cid:`, as
 * Nodemailer's `attachDataUrls` does for SMTP, since Gmail and Outlook block data URIs.
 */
export function inlineImages(html: string): { html: string; images: (FileAttachment & { size: number })[] } {
  const images: (FileAttachment & { size: number })[] = [];
  const out = html.replace(/(\bsrc\s*=\s*)(["'])data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[^,;"']*)*?);base64,([^"']*)\2/gi, (_all, attr: string, quote: string, type: string | undefined, _params, data: string) => {
    const contentType = (type ?? 'application/octet-stream').toLowerCase();
    const contentBytes = data.replace(/\s+/g, '');
    const n = images.length + 1;
    const contentId = `image${n}@spooldoc`;
    images.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: `image${n}.${EXTENSIONS[contentType] ?? 'bin'}`,
      contentType,
      contentBytes,
      isInline: true,
      contentId,
      size: Buffer.from(contentBytes, 'base64').length,
    });
    return `${attr}${quote}cid:${contentId}${quote}`;
  });
  return { html: out, images };
}

const bytesOf = (content: unknown): Buffer => {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  throw new Error('A file of the email has no content to send.');
};

/**
 * The Graph sendMail request for a message composed for Nodemailer: From with its name,
 * To, Cc, Bcc, Reply-To, the subject, the HTML message (or the text when there is no
 * HTML), the files, and the data URI images as inline attachments. Graph takes one body,
 * so an HTML message goes without its plain-text version.
 *
 * @throws GraphMailError `too_large` when a file is over 3 MB or the request over 4 MB
 */
export function graphMessage(message: SendMailOptions): { message: Record<string, unknown>; saveToSentItems: boolean } {
  const html = typeof message.html === 'string' ? message.html : null;
  const text = typeof message.text === 'string' ? message.text : '';
  const inlined = html ? inlineImages(html) : { html: null, images: [] };
  const files: (FileAttachment & { size: number })[] = (message.attachments ?? []).map((file, index) => {
    const content = bytesOf(file.content);
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: file.filename || `file${index + 1}`,
      contentType: file.contentType ?? 'application/octet-stream',
      contentBytes: content.toString('base64'),
      size: content.length,
    };
  });
  const attachments = [...files, ...inlined.images];
  const big = attachments.find((file) => file.size > GRAPH_FILE_LIMIT);
  if (big) throw new GraphMailError('too_large', `${big.name} is ${megabytes(big.size)}; sendMail takes files up to 3 MB.`, big.name);
  const [from] = recipients(message.from);
  const graph = {
    message: {
      subject: message.subject ?? '',
      body: inlined.html !== null ? { contentType: 'HTML', content: inlined.html } : { contentType: 'Text', content: text },
      ...(from ? { from } : {}),
      toRecipients: recipients(message.to),
      ...(message.cc ? { ccRecipients: recipients(message.cc) } : {}),
      ...(message.bcc ? { bccRecipients: recipients(message.bcc) } : {}),
      ...(message.replyTo ? { replyTo: recipients(message.replyTo) } : {}),
      ...(attachments.length > 0 ? { attachments: attachments.map((file) => ({ ...file, size: undefined })) } : {}),
    },
    saveToSentItems: true,
  };
  const size = Buffer.byteLength(JSON.stringify(graph));
  if (size > GRAPH_REQUEST_LIMIT) throw new GraphMailError('too_large', `The request is ${megabytes(size)}; sendMail takes up to 4 MB.`);
  return graph;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The kind of a Graph error, from its status and code. */
function sendProblem(status: number, code: string, text: string, roles: string[] | null): GraphProblem {
  if (status === 429) return 'throttled';
  if (status === 413 || /ErrorMessageSizeExceeded|RequestBodyTooLarge|RequestEntityTooLarge/i.test(code) || /exceeds the maximum|too large/i.test(text)) return 'too_large';
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|MailboxNotFound|ResourceNotFound|ErrorNonExistentMailbox/i.test(code)) return 'mailbox';
  if (status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/i.test(code)) {
    if (/AccessPolicy|RAOP|RBAC|application access polic/i.test(text)) return 'policy';
    if (roles && !roles.includes('Mail.Send')) return 'consent';
    return 'denied';
  }
  if (/ErrorInvalidRecipients|ErrorInvalidRecipient|InvalidRecipients/i.test(code) || /recipient/i.test(text)) return 'recipient';
  if (status === 401) return 'sign_in';
  if (status >= 500) return 'service';
  return 'other';
}

/**
 * Sends an email through Microsoft Graph as the account's mailbox, with an access token
 * from the client credentials flow. A throttled request is tried again after the
 * Retry-After Microsoft asks for, up to a minute, twice; a rejected token is fetched
 * again once.
 *
 * @throws GraphMailError with what went wrong and Microsoft's own text
 */
export async function graphSendMail(account: M365Account, message: SendMailOptions): Promise<{ messageId?: string }> {
  const body = JSON.stringify(graphMessage(message));
  const url = `${microsoftUrls().graph}/v1.0/users/${encodeURIComponent(account.mailbox)}/sendMail`;
  let freshToken = false;
  for (let attempt = 0; ; attempt++) {
    const token = await graphToken(account);
    const response = await call(url, { method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' }, body });
    if (response.status === 202 || response.ok) return {};
    const error = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const code = error.error?.code ?? '';
    const text = error.error?.message ?? '';
    const detail = firstLine([code, text].filter(Boolean).join(': ')) ?? `${response.status} ${response.statusText}`.trim();
    if (response.status === 401 && !freshToken) {
      // The token was revoked or the cache is stale: get a new one and try once more.
      tokens.delete(tokenKey(account));
      freshToken = true;
      continue;
    }
    const wait = retryAfterSeconds(response.headers.get('retry-after'));
    const throttled = response.status === 429 || ((response.status === 503 || response.status === 504) && wait !== undefined);
    if (throttled) {
      const seconds = wait ?? 5;
      if (attempt < MAX_RETRIES && seconds <= MAX_WAIT_SECONDS) {
        await graphTiming.sleep(seconds * 1000);
        continue;
      }
      throw new GraphMailError('throttled', detail, undefined, seconds);
    }
    throw new GraphMailError(sendProblem(response.status, code, text, token.roles), detail);
  }
}

/**
 * A Microsoft 365 error in plain words, with what to do next. The wrong tenant, client ID
 * or secret, an expired secret, a missing permission or consent, a mailbox the access
 * policy leaves out or that does not exist, throttling and a message that is too large
 * each say what to check.
 */
export function graphErrorMessage(error: GraphMailError, account: Pick<M365Account, 'tenantId' | 'clientId' | 'mailbox'>): string {
  const where = 'in Settings, under Mail server';
  switch (error.problem) {
    case 'tenant':
      return `Microsoft 365 has no tenant ${account.tenantId}. Check the directory (tenant) ID ${where}. It is on the Overview page of the app registration in Microsoft Entra ID.`;
    case 'client':
      return `Microsoft 365 has no application ${account.clientId} in this tenant. Check the application (client) ID and the tenant ID ${where}.`;
    case 'secret':
      return `Microsoft 365 refused the client secret. Enter the secret's value, not its ID, ${where}. Make a new secret in the app registration if the value is lost.`;
    case 'secret_expired':
      return `The client secret has expired. Make a new one under Certificates & secrets in the app registration, and enter its value ${where}.`;
    case 'consent':
      return 'The app has no permission to send email. Give it the Mail.Send application permission with admin consent in Microsoft Entra ID, or the Application Mail.Send role in Exchange Online for this mailbox.';
    case 'policy':
      return `Microsoft 365 does not let the app send as ${account.mailbox}. Add the mailbox to the app's application access policy or RBAC scope, or send from a mailbox it covers.`;
    case 'denied':
      return `Microsoft 365 refused to send as ${account.mailbox}. Check that the app has Mail.Send with admin consent, or the Application Mail.Send role, and that its access policy or RBAC scope covers this mailbox.`;
    case 'mailbox':
      return `Microsoft 365 has no mailbox ${account.mailbox}. Check the From address ${where}: it must be a mailbox of the tenant with an Exchange Online license, or a shared mailbox.`;
    case 'throttled':
      return `Microsoft 365 is throttling the app${error.retryAfter !== undefined ? ` and asks to wait ${error.retryAfter} seconds` : ''}. Retry the run later.`;
    case 'too_large':
      return error.file
        ? `${error.file} is larger than the 3 MB Microsoft 365 takes for a file here. Attach fewer formats, make the document smaller, or send it through an SMTP server.`
        : 'The email is larger than the 4 MB Microsoft 365 takes here. Attach fewer formats, make the documents smaller, or send them through an SMTP server.';
    case 'recipient':
      return "Microsoft 365 refused an address of the email. Check the job's To, Cc, Bcc and Reply-To.";
    case 'network':
      return `Could not reach Microsoft 365. Check that the Spooldoc server can connect to ${microsoftUrls().login.replace(/^https?:\/\//, '')} and ${microsoftUrls().graph.replace(/^https?:\/\//, '')} on port 443.`;
    case 'sign_in':
      return `Microsoft 365 refused the sign-in. Check the tenant ID, the client ID and the client secret ${where}.`;
    case 'service':
      return 'Microsoft 365 had a problem and did not take the email. Retry the run later.';
    default:
      return `Microsoft 365 did not take the email: ${error.detail ?? 'no reason given'}`;
  }
}
