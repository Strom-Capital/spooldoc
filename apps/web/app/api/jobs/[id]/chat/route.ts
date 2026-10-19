import { convertToModelMessages, generateId, isStepCount, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import { assetNames } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { buildInstructions, buildTools, hasContent, trimHistory, wordTemplates } from '@/lib/server/chat';
import { getConfig } from '@/lib/server/config';
import { previewRenderer } from '@/lib/server/documents';
import { draftStore } from '@/lib/server/draft-store';
import { errorResponse, json, readJson, redact } from '@/lib/server/http';
import { clearChat, readChat, saveChat } from '@/lib/server/job-chat';
import { jobFilesReader } from '@/lib/server/job-files';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { log } from '@/lib/server/log';
import { createModel } from '@/lib/server/models';
import { getRendering } from '@/lib/server/rendering';
import { getTemplateFile } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

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

/** The job's stored thread: `{ messages }`, the UI messages the chat panel shows. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  return json({ messages: await readChat(job.id) });
}

/**
 * Stream the model's answer for one job. The model gets the job's preview spooled file
 * (page text masked by default), its metadata and the draft's definition and template,
 * the recent part of the thread, and tools that read the sample, write the draft and
 * read other jobs' definitions and templates. It never gets the login session or the
 * IBM i connection. When the answer ends, the whole thread is stored with the job.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
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
  const templateFile = async (fileId: string) => (await getTemplateFile(fileId))?.content ?? null;
  const words = await wordTemplates(draft.render.outputs, draft.extract.definition, getTemplateFile);
  const safe = (error: unknown): string => redact(error, secrets).replace(KEY_PATTERN, '***');

  try {
    const result = streamText({
      model,
      reasoning,
      instructions: buildInstructions({
        sample,
        definitionYaml: draft.extract.definition.trim() ? draft.extract.definition : null,
        outputs: draft.render.outputs,
        masked: config.mask,
        assets,
        carbone: (await getRendering()).check,
        wordTemplates: words,
      }),
      messages: await convertToModelMessages(trimHistory(messages), { ignoreIncompleteToolCalls: true }),
      tools: buildTools({
        sample,
        store: draftStore(job.id),
        masked: config.mask,
        assets,
        renderer: await previewRenderer(),
        jobs: jobFilesReader(job.id),
        templateFile,
      }),
      stopWhen: isStepCount(MAX_STEPS),
      abortSignal: request.signal,
      // The client gets the error from the stream; the server log gets it here, redacted.
      onError: ({ error }) => log.warn('The AI chat failed', { jobId: job.id, error: safe(error) }),
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      // The answer gets its id here, so the stored message and the one on screen are the same.
      generateMessageId: generateId,
      // Also after a stop: the part that arrived stays on screen, so it stays in the thread.
      // A turn whose answer failed before its first token leaves the thread as it was. A
      // thread that cannot be written (the job was deleted meanwhile) is let go, and logged.
      onFinish: ({ responseMessage, messages: thread }) =>
        hasContent(responseMessage)
          ? saveChat(job.id, thread).catch((error: unknown) => log.warn('Could not save the AI chat', { jobId: job.id, error: safe(error) }))
          : undefined,
      onError: safe,
    });
  } catch (error) {
    log.error('The AI chat could not start', { jobId: job.id, error: safe(error) });
    return errorResponse(500, safe(error));
  }
}

/** Forget the job's thread: New chat. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  await clearChat(job.id);
  return new Response(null, { status: 204 });
}
