import { z } from 'zod';
import { AI_PROVIDER_IDS, EFFORT_IDS } from '@/lib/ai-providers';
import { guard } from '@/lib/server/auth';
import { json, readJson } from '@/lib/server/http';
import { getAiSettings, getSettings, updateAiSettings, updateSettings } from '@/lib/server/settings';
import { cleanupStatus, watchStatus } from '@/lib/server/watcher';

export const dynamic = 'force-dynamic';

const isHttp = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const aiSchema = z
  .object({
    provider: z.enum(AI_PROVIDER_IDS, 'Choose a provider from the list').nullable(),
    model: z.string().trim().min(1, 'Enter a model').max(200, 'The model id is too long').optional(),
    effort: z.enum(EFFORT_IDS, 'Choose an effort from the list').optional(),
    baseUrl: z
      .string()
      .trim()
      .max(500, 'The base URL is too long')
      .refine(isHttp, 'Enter an http or https URL')
      .transform((value) => value.replace(/\/+$/, ''))
      .optional(),
    apiKey: z.string().trim().max(500, 'The key is too long').nullable().optional(),
  })
  .refine((ai) => ai.provider !== 'local' || ai.baseUrl, { message: 'Enter the base URL of the local model', path: ['baseUrl'] })
  .refine((ai) => ai.provider !== 'local' || ai.model, { message: 'Enter a model', path: ['model'] });

const settingsSchema = z
  .object({
    pollSeconds: z.number().int().min(5, 'Poll at most every 5 seconds').max(3600, 'Poll at least every hour'),
    safetyCheckSeconds: z.number().int().min(60, 'Check at most every minute').max(86400, 'Check at least once a day'),
    retentionDays: z.number().int().min(1, 'Keep runs at least 1 day').max(3650, 'Keep runs at most 3650 days'),
    ai: aiSchema,
  })
  .partial();

async function view(): Promise<Response> {
  return json({ ...(await getSettings()), watching: watchStatus(), cleanup: cleanupStatus(), ai: await getAiSettings() });
}

/** The watcher intervals, the retention, how many queues are watched or polled, and the chat model (never a key). */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return view();
}

/** Change the settings. The watcher uses them from its next tick, the chat from its next message. */
export async function PUT(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, settingsSchema);
  if ('response' in body) {
    return body.response;
  }
  const { ai, ...change } = body.data;
  if (Object.keys(change).length > 0) {
    await updateSettings(change);
  }
  if (ai) {
    await updateAiSettings(ai);
  }
  return view();
}
