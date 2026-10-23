import { z } from 'zod';
import { AI_PROVIDER_IDS, EFFORT_IDS } from '@/lib/ai-providers';
import { guard } from '@/lib/server/auth';
import { invalidResponse, json, readJson } from '@/lib/server/http';
import { formatsSchema } from '@/lib/formats';
import { mailSettingsSchema } from '@/lib/mail-config';
import { getFormats, updateFormats } from '@/lib/server/formats';
import { getMailView, mailChangeProblem, updateMail } from '@/lib/server/mail';
import { getRendering, updateRendering } from '@/lib/server/rendering';
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
    mask: z.boolean('Masking is on or off').optional(),
  })
  .refine((ai) => ai.provider !== 'local' || ai.baseUrl, { message: 'Enter the base URL of the local model', path: ['baseUrl'] })
  .refine((ai) => ai.provider !== 'local' || ai.model, { message: 'Enter a model', path: ['model'] });

const renderingSchema = z
  .object({
    mode: z.enum(['onprem', 'cloud'], 'Choose on-prem or Carbone Cloud'),
    url: z
      .string()
      .trim()
      .max(500, 'The URL is too long')
      .refine(isHttp, 'Enter an http or https URL, such as http://carbone:4000')
      .transform((value) => value.replace(/\/+$/, ''))
      .optional(),
    apiKey: z.string().trim().max(2000, 'The key is too long').nullable().optional(),
  })
  .refine((rendering) => rendering.mode !== 'onprem' || rendering.url, { message: 'Enter the URL of the Carbone server', path: ['url'] });

const settingsSchema = z
  .object({
    pollSeconds: z.number().int().min(5, 'Poll at most every 5 seconds').max(3600, 'Poll at least every hour'),
    safetyCheckSeconds: z.number().int().min(60, 'Check at most every minute').max(86400, 'Check at least once a day'),
    retentionDays: z.number().int().min(1, 'Keep runs at least 1 day').max(3650, 'Keep runs at most 3650 days'),
    ai: aiSchema,
    rendering: renderingSchema,
    mail: mailSettingsSchema,
    formats: formatsSchema,
  })
  .partial();

async function view(): Promise<Response> {
  return json({ ...(await getSettings()), watching: watchStatus(), cleanup: cleanupStatus(), ai: await getAiSettings(), rendering: await getRendering(), mail: await getMailView(), formats: await getFormats() });
}

/** The watcher intervals, the retention, how many queues are watched or polled, the chat model and the Carbone connection (never a key). */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return view();
}

/**
 * Change the settings. The watcher uses them from its next tick, the chat from its next
 * message. A rendering change checks the Carbone connection again before it answers.
 */
export async function PUT(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, settingsSchema);
  if ('response' in body) {
    return body.response;
  }
  const { ai, rendering, mail, formats, ...change } = body.data;
  const mailProblem = mail ? await mailChangeProblem(mail) : null;
  if (mailProblem) {
    return invalidResponse(mailProblem.message, mailProblem.path);
  }
  if (Object.keys(change).length > 0) {
    await updateSettings(change);
  }
  if (formats) {
    await updateFormats(formats);
  }
  if (mail) {
    await updateMail(mail);
  }
  if (ai) {
    await updateAiSettings(ai);
  }
  if (rendering) {
    await updateRendering(rendering);
  }
  return view();
}
