import 'server-only';

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { SpooledFileAttributes, SpooledFileId } from '@spooldoc/core';
import { docsVersion } from './docs';
import type { RunDocument, RunFile } from './destinations';

/** What a webhook call is about, besides its document: the job, the run and the spooled file. */
export interface WebhookContext {
  /** The version is null for a test from the job builder, which sends the draft. */
  job: { id: string; name: string; version: number | null };
  /** Null for a test from the job builder, which runs nothing. */
  run: { id: string; seq: number } | null;
  splf: SpooledFileId;
  attributes: SpooledFileAttributes;
}

/** `document.created` for a run, `document.test` for a test call or a destination in test mode. */
export type WebhookType = 'document.created' | 'document.test';

/** A file in a call. `content` is base64; the preview shows its size instead. */
export interface WebhookFile {
  name: string;
  contentType: string;
  size: number;
  template: string;
  content: string;
}

/** The JSON body of one webhook call: one document. */
export interface WebhookPayload {
  type: WebhookType;
  timestamp: string;
  data: {
    document: { name: string; pageGroup: number | null; pageGroups: number };
    job: { id: string; name: string; version: number | null };
    run: { id: string; number: number } | null;
    spooledFile: {
      name: string;
      number: number;
      jobName: string;
      jobUser: string;
      jobNumber: string;
      outputQueue: string;
      userData: string;
      pages: number;
    };
    /** Exactly what the templates get: `{ pg, splf }`, or `{ pgs, splf }` for the whole spooled file. */
    data: unknown;
    files: WebhookFile[];
  };
}

/** An ISO time to the second, such as `2026-10-21T09:14:03Z`. */
const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The body of the call for one document, with the files that go with it.
 *
 * @param pageGroups - How many page groups the spooled file has
 */
export function webhookPayload(input: { type: WebhookType; at: Date; document: Pick<RunDocument, 'pageGroupIndex' | 'name' | 'data'>; pageGroups: number; context: WebhookContext; files: RunFile[] }): WebhookPayload {
  const { document, context } = input;
  const { splf, attributes } = context;
  return {
    type: input.type,
    timestamp: isoSeconds(input.at),
    data: {
      document: { name: document.name, pageGroup: document.pageGroupIndex === null ? null : document.pageGroupIndex + 1, pageGroups: input.pageGroups },
      job: { id: context.job.id, name: context.job.name, version: context.job.version },
      run: context.run ? { id: context.run.id, number: context.run.seq } : null,
      spooledFile: {
        name: splf.name,
        number: splf.number,
        jobName: splf.jobName,
        jobUser: splf.jobUser,
        jobNumber: splf.jobNumber,
        outputQueue: `${attributes.queue.library}/${attributes.queue.name}`,
        userData: attributes.userData,
        pages: attributes.pages,
      },
      data: document.data,
      files: input.files.map((file) => ({
        name: file.name,
        contentType: file.contentType,
        size: file.content.byteLength,
        template: file.template,
        content: Buffer.from(file.content).toString('base64'),
      })),
    },
  };
}

/** A new signing secret: `whsec_` and 32 random bytes in base64, as Standard Webhooks writes them. */
export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

/**
 * The id of the call for a document of a spooled file, the same on every Retry, so a
 * receiver can tell a call it already took. A test call gets an id of its own.
 */
export function webhookId(input: { jobId: string; splfKey: string; document: string; test: boolean }): string {
  const hash = createHash('sha256').update([input.jobId, input.splfKey, input.document, input.test ? 'test' : ''].join('\n')).digest('hex');
  return `msg_${hash.slice(0, 32)}`;
}

/** A random call id, for a test from the job builder. */
export const randomWebhookId = (): string => `msg_${randomBytes(16).toString('hex')}`;

/**
 * The Standard Webhooks signature of a call: `v1,` and the base64 HMAC-SHA256 of
 * `<id>.<timestamp>.<body>`, keyed with the bytes of the secret after `whsec_`.
 */
export function webhookSignature(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

let agent: string | undefined;

/** `Spooldoc/0.3.1`, the User-Agent of every call. */
export function webhookUserAgent(): string {
  if (agent === undefined) {
    try {
      agent = `Spooldoc/${docsVersion()}`;
    } catch {
      agent = 'Spooldoc';
    }
  }
  return agent;
}

/** The headers of a call, in the order they are printed. Custom headers come last and are left out of a call to the test URL. */
export function webhookHeaders(input: {
  url: string;
  id: string;
  timestamp: number;
  body: string;
  secret: string | null;
  headers: { name: string; value: string }[];
  toTestUrl: boolean;
}): { name: string; value: string }[] {
  return [
    { name: 'host', value: new URL(input.url).host },
    { name: 'content-type', value: 'application/json' },
    { name: 'user-agent', value: webhookUserAgent() },
    { name: 'webhook-id', value: input.id },
    { name: 'webhook-timestamp', value: String(input.timestamp) },
    ...(input.secret ? [{ name: 'webhook-signature', value: webhookSignature(input.secret, input.id, input.timestamp, input.body) }] : []),
    ...(input.toTestUrl ? [] : input.headers),
  ];
}
