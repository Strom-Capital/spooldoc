import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import { buildInstructions, buildTools } from '@/lib/server/chat';
import { getConfig } from '@/lib/server/config';
import { checkOrigin, errorResponse, readJson, redact, workspaceErrorResponse } from '@/lib/server/http';
import { createModel } from '@/lib/server/models';
import { getWorkspace } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Model steps per request: each tool call and answer is one step. */
const MAX_STEPS = 12;

const chatRequest = z.object({
  sampleId: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, 'not a sample id')
    .refine((id) => !id.includes('..') && !id.startsWith('.'), 'not a sample id'),
  messages: z
    .array(z.custom<UIMessage>((value) => typeof value === 'object' && value !== null && 'role' in value && 'parts' in value))
    .min(1)
    .max(500),
});

/** Anything that looks like an API key, in case a provider echoes one back. */
const KEY_PATTERN = /\b(sk|key|token)-[A-Za-z0-9_-]{6,}/gi;

/**
 * Stream the model's answer for one sample. The model gets the sample's page text
 * (masked by default), its metadata and the current definition and template, and
 * tools that read the sample and write files in the workspace. It never gets the
 * session or the IBM i connection.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const body = await readJson(request, chatRequest);
  if ('response' in body) {
    return body.response;
  }
  const { sampleId, messages } = body.data;
  const config = getConfig();
  const ws = getWorkspace();

  let sample;
  let definitionYaml: string | null = null;
  let templateHtml: string | null = null;
  try {
    sample = await ws.readSample(sampleId);
    if (!sample) {
      return errorResponse(404, `Sample ${sampleId} not found.`);
    }
    if (sample.definition) {
      definitionYaml = await ws.readDefinition(sample.definition).catch(() => null);
      templateHtml = await ws.readTemplate(sample.definition).catch(() => null);
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }

  const model = createModel();
  if (!model) {
    return errorResponse(503, 'No model configured');
  }
  const secrets = [config.anthropicApiKey, config.openaiCompatible?.apiKey].filter((key): key is string => !!key);
  const safe = (error: unknown): string => redact(error, secrets).replace(KEY_PATTERN, '***');

  try {
    const result = streamText({
      model,
      instructions: buildInstructions({ sample, definitionYaml, templateHtml, masked: config.mask }),
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: buildTools({ sampleId, workspace: ws, masked: config.mask }),
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
