import 'server-only';

import { redact } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import { shortUrl, urlWithoutQuery, WEBHOOK_TIMEOUT_SECONDS, type WebhookConfig } from '@/lib/destination-config';
import { bytes } from '@/lib/client/format';
import { emptyWebhookSpec, FORMAT_FILES, type Format } from '@/lib/job-spec';
import { RESPONSE_LIMIT } from '../runs';
import { getDb } from '../db';
import { runDeliveries, runs } from '../db/schema';
import { retryAfterSeconds } from '../http';
import { decryptSecret, encryptSecret } from '../secrets';
import { StepError } from '../step-error';
import { webhookHeaders, webhookId, webhookPayload, type WebhookType } from '../webhook-payload';
import type { DeliverInput, Destination, RunFile } from './index';
import { storeRunFiles } from './store';

/** The secrets of a webhook destination, kept encrypted in `destinations.secrets_enc`. */
export interface WebhookSecrets {
  signingSecret: string | null;
  /** The custom headers, by name, in the order they were added. */
  headers: { name: string; value: string }[];
}

/** Seal the secrets of a webhook destination for `destinations.secrets_enc`. */
export function sealWebhookSecrets(secrets: WebhookSecrets): string {
  return encryptSecret(JSON.stringify({ signingSecret: secrets.signingSecret, headers: Object.fromEntries(secrets.headers.map((h) => [h.name, h.value])) }));
}

/**
 * The secrets of a webhook destination. None saved gives no secret and no headers.
 *
 * @throws Error when they cannot be decrypted, such as after SPOOLDOC_SECRET_KEY changed
 */
export function openWebhookSecrets(sealed: string | null): WebhookSecrets {
  if (!sealed) return { signingSecret: null, headers: [] };
  const parsed = JSON.parse(decryptSecret(sealed, 'webhook secret and header values')) as { signingSecret?: string | null; headers?: Record<string, string> };
  return { signingSecret: parsed.signingSecret ?? null, headers: Object.entries(parsed.headers ?? {}).map(([name, value]) => ({ name, value })) };
}

/** The values to keep out of every error: the signing secret and each header value. */
export const webhookSecretValues = (secrets: WebhookSecrets): string[] => [secrets.signingSecret ?? '', ...secrets.headers.map((h) => h.value)].filter((s) => s.length > 0);

/** "1 document", "3 documents". */
export const nDocuments = (n: number): string => `${n} ${n === 1 ? 'document' : 'documents'}`;

/** Waits between tries. Tests replace it. */
export const webhookTiming = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

/** The waits before the second and third try, when the receiver gives no Retry-After. */
const WAITS_MS = [2_000, 10_000];
/** The longest Retry-After Spooldoc waits for. */
const MAX_WAIT_SECONDS = 60;
export const MAX_ATTEMPTS = 3;

/** Where a call goes, and what it carries besides the body. */
export interface WebhookTarget {
  /** The URL in use: the test URL while one is set. */
  url: string;
  /** The call goes to the test URL, so the custom headers are left out. */
  toTestUrl: boolean;
  secret: string | null;
  headers: { name: string; value: string }[];
  /** The destination's name, for the error messages. */
  destination: string;
}

/** What one call came to, after its tries. */
export interface WebhookCallResult {
  ok: boolean;
  /** The receiver's last status; null when it never answered. */
  status: number | null;
  statusText: string;
  attempts: number;
  /** How long the last try took. */
  ms: number;
  /** The start of the receiver's last answer, at most `RESPONSE_LIMIT` characters and one more to tell it was cut. */
  response: string | null;
  /** For a failed call: what went wrong and what to do, the receiver's own text, and whether the next call would fail too. */
  error?: { message: string; detail?: string; stops: boolean };
}

/** The first `limit` characters of a response and one more, without reading a large body to its end. */
async function readStart(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length <= limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // An answer cut off part way: keep what came.
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return text.slice(0, limit + 1);
}

/** A network failure: the cause's code, such as ENOTFOUND, and the text. */
interface NetworkFailure {
  code: string | undefined;
  text: string;
  timeout: boolean;
}

/** A fetch that answers a network failure instead of throwing, with the cause's code. */
async function call(url: string, init: RequestInit): Promise<Response | NetworkFailure> {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_SECONDS * 1000) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const text = [error instanceof Error ? error.message : String(error), cause?.message].filter(Boolean).join(': ');
    return { code: cause?.code, text, timeout };
  }
}

const CERT_CODES = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i;

/** The words for a certificate error code. */
function certificateReason(code: string): string {
  if (/EXPIRED/i.test(code)) return 'its certificate has expired';
  if (/NOT_YET_VALID/i.test(code)) return 'its certificate is not valid yet';
  if (/ALTNAME|HOSTNAME/i.test(code)) return 'its certificate is for another host name';
  if (/SELF_SIGNED/i.test(code)) return 'its certificate is self-signed';
  if (/UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code)) return 'its certificate is signed by an authority Spooldoc does not know';
  return `the secure connection failed (${code})`;
}

/** A network failure in plain words, with what to do, and whether the next call would fail too. */
function networkError(failure: NetworkFailure, url: URL, target: WebhookTarget): { message: string; detail?: string; stops: boolean } {
  const host = url.hostname;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const detail = failure.code ? `${failure.code}: ${failure.text}` : failure.text;
  if (failure.timeout) {
    return { message: `${host} did not answer within ${WEBHOOK_TIMEOUT_SECONDS} seconds. Check that the receiver is up, then retry the run.`, detail, stops: false };
  }
  const code = failure.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { message: `Could not find the host ${host}. Check the URL of ${target.destination}.`, detail, stops: true };
  }
  if (code === 'ECONNREFUSED') {
    return { message: `Could not connect to ${host} on port ${port}: the connection was refused. Check that the receiver is running and listens on port ${port}.`, detail, stops: true };
  }
  if (CERT_CODES.test(code)) {
    return {
      message: `Could not connect securely to ${host}: ${certificateReason(code)}. If the receiver uses your own certificate authority, add it as Configuration describes under Certificates (docs/configuration.md).`,
      detail,
      stops: true,
    };
  }
  return { message: `Could not reach ${host}. Check that the Spooldoc server can connect to it on port ${port}.`, detail, stops: true };
}

/** A receiver's answer that is not 2xx, in plain words, with what to do. */
function statusError(response: Response, text: string, url: URL, target: WebhookTarget, attempts: number, bodyBytes: number): { message: string; detail?: string; stops: boolean } {
  const host = url.hostname;
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const detail = text.trim() ? text.slice(0, RESPONSE_LIMIT) : undefined;
  const tries = attempts > 1 ? ` after ${attempts} tries` : '';
  const fail = (message: string) => ({ message, detail, stops: false });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    const to = location ? ` and points to ${urlWithoutQuery(new URL(location, url).href)}` : '';
    return fail(`Could not deliver: ${host} answered ${status}${to}. Spooldoc does not follow redirects. Change the URL of ${target.destination} to the address the receiver takes.`);
  }
  if (response.status === 401 || response.status === 403) return fail(`${host} refused the call (${status}). Check the headers of ${target.destination}.`);
  if (response.status === 404 || response.status === 405 || response.status === 410) {
    return fail(`${host} has nothing that takes the call at ${url.pathname} (${status}). Check the URL of ${target.destination}.`);
  }
  if (response.status === 413) {
    return fail(`${host} refused the call as too large (${status}): it was ${bytes(bodyBytes)}. Turn off files the receiver does not need in the job's Destination step.`);
  }
  if (response.status === 429) return fail(`${host} asked Spooldoc to slow down (${status})${tries}. Retry the run later.`);
  if (response.status >= 500) return fail(`${host} had a problem and did not take the call (${status})${tries}. Retry the run later.`);
  return fail(`${host} refused the call (${status}). Its answer is under Details.`);
}

const retried = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * Post one call: POST with the JSON body, signed, without following redirects, waiting
 * at most 30 seconds. A network error, 408, 429 or 5xx is tried again after 2 and then
 * 10 seconds, or after the Retry-After the receiver asks for, up to a minute, for at most
 * `maxAttempts` tries. Any other answer is final. Never throws.
 */
export async function postWebhook(target: WebhookTarget, input: { id: string; body: string; maxAttempts?: number }): Promise<WebhookCallResult> {
  const url = new URL(target.url);
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS;
  const bodyBytes = Buffer.byteLength(input.body);
  for (let attempt = 1; ; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = webhookHeaders({ url: target.url, id: input.id, timestamp, body: input.body, secret: target.secret, headers: target.headers, toTestUrl: target.toTestUrl });
    const started = performance.now();
    const answer = await call(target.url, {
      method: 'POST',
      // fetch sets Host itself.
      headers: headers.filter((h) => h.name !== 'host').map((h) => [h.name, h.value] as [string, string]),
      body: input.body,
    });
    if (!(answer instanceof Response)) {
      const ms = Math.round(performance.now() - started);
      if (attempt < maxAttempts) {
        await webhookTiming.sleep(WAITS_MS[attempt - 1] ?? WAITS_MS.at(-1)!);
        continue;
      }
      return { ok: false, status: null, statusText: '', attempts: attempt, ms, response: null, error: networkError(answer, url, target) };
    }
    const text = await readStart(answer, RESPONSE_LIMIT);
    const ms = Math.round(performance.now() - started);
    const result = { status: answer.status, statusText: answer.statusText, attempts: attempt, ms, response: text || null };
    if (answer.status >= 200 && answer.status < 300) return { ok: true, ...result };
    if (retried(answer.status) && attempt < maxAttempts) {
      const asked = retryAfterSeconds(answer.headers.get('retry-after'));
      if (asked === undefined || asked <= MAX_WAIT_SECONDS) {
        await webhookTiming.sleep(asked !== undefined ? asked * 1000 : (WAITS_MS[attempt - 1] ?? WAITS_MS.at(-1)!));
        continue;
      }
    }
    return { ok: false, ...result, error: statusError(answer, text, url, target, attempt, bodyBytes) };
  }
}

/** The formats a job sends with each call. */
export const webhookFormats = (input: Pick<DeliverInput, 'webhook'>): Format[] => (input.webhook ?? emptyWebhookSpec()).attach;

/** The files of a document that go in its call. */
export function callFiles(files: RunFile[], pageGroupIndex: number | null, formats: Format[]): RunFile[] {
  const types = new Set(formats.map((format) => FORMAT_FILES[format].contentType));
  return files.filter((file) => file.pageGroupIndex === pageGroupIndex && types.has(file.contentType));
}

type DeliveryRow = typeof runDeliveries.$inferInsert;

/**
 * Posts one call per document to the destination's URL, as JSON with the document's data
 * and the files in the formats the job picks, signed with the destination's secret. The
 * files are kept in Spooldoc first, so the download works too. A document an earlier run
 * of the same job already sent for the same spooled file is not sent again (a test call
 * does not count), so Retry sends only the rest, with the same `webhook-id`. Every call is
 * recorded as it goes. When the host cannot be reached, the rest are not tried. When any
 * fails, the step fails after the others are sent, so the finish step does not run.
 */
export function webhookDestination(config: WebhookConfig, secrets: WebhookSecrets, name: string): Destination {
  return {
    kind: 'webhook',
    async deliver(input: DeliverInput) {
      const { runId, files, documents, job, context } = input;
      const hidden = webhookSecretValues(secrets);
      for (const secret of hidden) input.addSecret(secret);
      const clean = (text: string) => redact(text, hidden);

      await storeRunFiles(runId, files);

      const test = config.testUrl !== null;
      const target: WebhookTarget = { url: config.testUrl ?? config.url, toTestUrl: test, secret: secrets.signingSecret, headers: secrets.headers, destination: name };
      const host = new URL(target.url).hostname;
      const type: WebhookType = test ? 'document.test' : 'document.created';
      const formats = webhookFormats(input);

      const db = getDb();
      // Documents sent for real by an earlier run of this job on this spooled file.
      const earlier = await db
        .select({ document: runDeliveries.document, seq: runs.seq })
        .from(runDeliveries)
        .innerJoin(runs, eq(runs.id, runDeliveries.runId))
        .where(and(eq(runDeliveries.kind, 'webhook'), eq(runDeliveries.jobId, job.id), eq(runDeliveries.splfKey, job.splfKey), eq(runDeliveries.status, 'sent'), eq(runDeliveries.test, false)))
        .orderBy(runs.seq);
      const sentIn = new Map<string, number>();
      for (const row of earlier) if (!sentIn.has(row.document)) sentIn.set(row.document, row.seq);

      // A call per page group; the whole spooled file's document only when one of its files goes.
      const calls = documents.filter((document) => document.pageGroupIndex !== null || callFiles(files, null, formats).length > 0);
      const pageGroups = documents.filter((document) => document.pageGroupIndex !== null).length;
      const to = urlWithoutQuery(target.url);
      const record = (row: Omit<DeliveryRow, 'runId' | 'jobId' | 'splfKey' | 'destinationId' | 'kind'>) =>
        db.insert(runDeliveries).values({ runId, jobId: job.id, splfKey: job.splfKey, destinationId: input.destinationId, kind: 'webhook', ...row });

      let sent = 0;
      let already = 0;
      const failures: { message: string; detail?: string }[] = [];
      let stopped: { message: string; detail?: string } | null = null;
      for (const document of calls) {
        const base = { pageGroupIndex: document.pageGroupIndex, document: document.name };
        const before = sentIn.get(document.name);
        if (before !== undefined) {
          already++;
          await record({ ...base, to, status: 'already_sent', sentInRun: before });
          continue;
        }
        const id = webhookId({ jobId: job.id, splfKey: job.splfKey, document: document.name, test });
        if (stopped) {
          const message = `Not sent: ${stopped.message}`;
          failures.push({ message: `${document.name}: ${message}` });
          await record({ ...base, to, test, status: 'failed', messageId: id, attempts: 0, error: message, detail: stopped.detail ?? null });
          continue;
        }
        const payload = webhookPayload({ type, at: new Date(), document, pageGroups, context, files: callFiles(files, document.pageGroupIndex, formats) });
        const result = await postWebhook(target, { id, body: JSON.stringify(payload) });
        const answer = {
          httpStatus: result.status,
          attempts: result.attempts,
          ms: result.ms,
          response: result.response === null ? null : clean(result.response),
          messageId: id,
        };
        if (result.ok) {
          sent++;
          await record({ ...base, to, test, status: 'sent', ...answer });
          continue;
        }
        const message = clean(result.error!.message);
        const detail = result.error!.detail === undefined ? undefined : clean(result.error!.detail);
        failures.push({ message: `${document.name}: ${message}`, detail });
        await record({ ...base, to, test, status: 'failed', ...answer, error: message, detail: detail ?? null });
        if (result.error!.stops) stopped = { message, detail };
      }

      const where = test ? `the test URL ${shortUrl(target.url)}` : host;
      if (failures.length > 0) {
        const first = failures[0]!;
        const more = failures.length > 1 ? ` ${failures.length - 1} more failed; the Webhook calls list of the run has each one.` : '';
        throw new StepError('deliver', `Sent ${sent + already} of ${nDocuments(calls.length)} to ${where}. ${first.message}${more}`, first.detail);
      }
      const runsBefore = [...new Set(calls.map((document) => sentIn.get(document.name)).filter((seq) => seq !== undefined))];
      const earlierText =
        already > 0 ? `, ${already} ${already === 1 ? 'was' : 'were'} sent in ${runsBefore.length === 1 ? `run #${runsBefore[0]}` : 'earlier runs'}` : '';
      return `Sent ${nDocuments(sent)} to ${where}${earlierText}`;
    },
  };
}
