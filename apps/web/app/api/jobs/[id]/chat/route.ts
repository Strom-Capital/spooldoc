import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import { assetNames } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { buildInstructions, buildTools } from '@/lib/server/chat';
import { getConfig } from '@/lib/server/config';
import { draftStore } from '@/lib/server/draft-store';
import { errorResponse, readJson, redact } from '@/lib/server/http';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { createModel } from '@/lib/server/models';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Model steps per request: each tool call and answer is one step. */
const MAX_STEPS = 12;

const chatRequest = z.object({
  messages: z
    .array(z.custom<UIMessage>((value) => typeof value === 'object' && value !== null && 'role' in value && 'parts' in value))
    .min(1)
    .max(500),
});

/** Anything that looks like an API key, in case a provider echoes one back. */
const KEY_PATTERN = /\b(sk|key|token)-[A-Za-z0-9_-]{6,}/gi;

/**
 * Stream the model's answer for one job. The model gets the job's preview spooled file
 * (page text masked by default), its metadata and the draft's definition and template,
 * and tools that read the sample and write the draft. It never gets the login session
 * or the IBM i connection.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, chatRequest);
  if ('response' in body) {
    return body.response;
  }
  const { messages } = body.data;
  const config = getConfig();
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const { draft, sample } = await draftAndSample(job);
  if (!sample) {
    return errorResponse(400, 'Pick a spooled file to work on first.');
  }

  let chat;
  try {
    chat = await createModel();
  } catch (error) {
    return errorResponse(503, error instanceof Error ? error.message : 'The model key cannot be read.');
  }
  if (!chat) {
    return errorResponse(503, 'No model set up. Choose one in Settings.');
  }
  const { model, reasoning, secrets } = chat;
  const assets = await assetNames();
  const safe = (error: unknown): string => redact(error, secrets).replace(KEY_PATTERN, '***');

  try {
    const result = streamText({
      model,
      reasoning,
      instructions: buildInstructions({
        sample,
        definitionYaml: draft.extract.definition.trim() ? draft.extract.definition : null,
        templateHtml: draft.render.template,
        masked: config.mask,
        assets,
      }),
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: buildTools({ sample, store: draftStore(job.id), masked: config.mask, assets }),
      stopWhen: isStepCount(MAX_STEPS),
      abortSignal: request.signal,
      // The default handler logs to the console; the client gets the error from the stream instead.
      onError: () => undefined,
    });
    return result.toUIMessageStreamResponse({ onError: safe });
  } catch (error) {
    return errorResponse(500, safe(error));
  }
}
