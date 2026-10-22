import 'server-only';

import { isCarboneError } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { webhookConfigSchema } from '@/lib/destination-config';
import { bytes } from '@/lib/client/format';
import { emptyWebhookSpec, webhookSpecSchema } from '@/lib/job-spec';
import { getDb } from './db';
import { destinations } from './db/schema';
import { callFiles, openWebhookSecrets, webhookSecretValues, type WebhookTarget } from './destinations/webhook';
import { documentNames, previewRenderer } from './documents';
import { errorResponse, json } from './http';
import { draftPageGroup } from './job-preview';
import type { JobRow } from './jobs';
import { CARBONE_NOT_CONNECTED } from './render';
import { renderFiles } from './runner';
import { StepError } from './step-error';
import { randomWebhookId, webhookPayload, type WebhookPayload } from './webhook-payload';

/** A preview or test of a webhook call, from the job builder. */
export const webhookCallSchema = z.object({
  pageGroupIndex: z.number().int().nonnegative().default(0),
  /** The webhook part as the editor has it, saved or not; the draft's when left out. */
  webhook: webhookSpecSchema.optional(),
  destinationId: z.string().uuid().nullable().optional(),
  sampleId: z.string().uuid().optional(),
});

/** The test call for one page group of the draft's preview sample, ready to post. */
export interface DraftCall {
  target: WebhookTarget;
  id: string;
  payload: WebhookPayload;
  /** The body as it is sent: compact JSON with every file in base64. */
  body: string;
  pageGroup: number;
  pageGroups: number;
  document: string;
  /** The signing secret and the header values, to keep out of every error. */
  secrets: string[];
}

/**
 * The call for one page group of the draft's preview sample: the page group rendered from
 * the draft in the formats the job sends, to the URL in use (the test URL while one is
 * set). It is `document.test` for a Send test and in test mode, else `document.created`,
 * as a run sends it. Nothing is sent and nothing is stored. A 4xx or 503 response when
 * there is nothing to call.
 *
 * @param use - `test` for a Send test, `preview` for the call a run would make
 */
export async function draftCall(job: JobRow, input: z.infer<typeof webhookCallSchema>, use: 'test' | 'preview'): Promise<DraftCall | { response: Response }> {
  const picked = await draftPageGroup(job, { sampleId: input.sampleId, pageGroup: input.pageGroupIndex }, 'the call');
  if ('response' in picked) return picked;
  const { draft, sample, def, groups, index } = picked;

  const destinationId = input.destinationId ?? draft.destination.destinationId;
  const [row] = destinationId ? await getDb().select().from(destinations).where(eq(destinations.id, destinationId)) : [];
  if (row?.kind !== 'webhook') return { response: errorResponse(400, 'Pick a webhook destination first.') };
  const config = webhookConfigSchema.safeParse(row.config);
  if (!config.success) return { response: errorResponse(422, `The settings of ${row.name} are not valid. Open it on the Destinations page and save it again.`) };
  let secrets;
  try {
    secrets = openWebhookSecrets(row.secretsEnc);
  } catch (error) {
    return { response: errorResponse(409, error instanceof Error ? error.message : String(error)) };
  }
  const { url, testUrl } = config.data;
  const target: WebhookTarget = { url: testUrl ?? url, toTestUrl: testUrl !== null, secret: secrets.signingSecret, headers: secrets.headers, destination: row.name };

  const formats = (input.webhook ?? draft.destination.webhook ?? emptyWebhookSpec()).attach;
  let files: Awaited<ReturnType<typeof renderFiles>>['files'] = [];
  const made = draft.render.templates.some((template) => template.formats.some((format) => formats.includes(format)));
  if (made) {
    const render = await previewRenderer();
    if (!render) return { response: errorResponse(503, CARBONE_NOT_CONNECTED) };
    try {
      files = (await renderFiles(draft, def, groups, sample, { render, pageGroup: index, formats })).files;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = error instanceof StepError || isCarboneError(error) ? error.detail : undefined;
      return { response: json({ error: `Could not render the files of the call. ${message}`, ...(detail ? { detail } : {}) }, { status: isCarboneError(error) ? 503 : 422 }) };
    }
  }
  // Named as a run names it, so two page groups with the same name get -2, -3 here too.
  const document = documentNames(def, groups, sample, false).pageGroups[index]!;
  const payload = webhookPayload({
    type: use === 'test' || target.toTestUrl ? 'document.test' : 'document.created',
    at: new Date(),
    document: { pageGroupIndex: index, name: document, data: { pg: groups[index]!, splf: sample.splf } },
    pageGroups: groups.length,
    context: { job: { id: job.id, name: job.name, version: null }, run: null, splf: sample.splf, attributes: sample.attributes },
    files: callFiles(files, index, formats),
  });
  return {
    target,
    id: randomWebhookId(),
    payload,
    body: JSON.stringify(payload),
    pageGroup: index,
    pageGroups: groups.length,
    document,
    secrets: webhookSecretValues(secrets),
  };
}

/** The body as the preview prints it: pretty JSON, each file's base64 replaced by its size. */
export function printedBody(payload: WebhookPayload): string {
  const shown = { ...payload, data: { ...payload.data, files: payload.data.files.map((file) => ({ ...file, content: `${bytes(file.content.length)} of base64` })) } };
  return JSON.stringify(shown, null, 2);
}
