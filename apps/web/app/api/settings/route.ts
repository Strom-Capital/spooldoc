import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { json, readJson } from '@/lib/server/http';
import { getSettings, updateSettings } from '@/lib/server/settings';
import { watchStatus } from '@/lib/server/watcher';

export const dynamic = 'force-dynamic';

const settingsSchema = z
  .object({
    pollSeconds: z.number().int().min(5, 'Poll at most every 5 seconds').max(3600, 'Poll at least every hour'),
    safetyCheckSeconds: z.number().int().min(60, 'Check at most every minute').max(86400, 'Check at least once a day'),
  })
  .partial();

/** The watcher intervals and how many queues are watched in real time or polled. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json({ ...(await getSettings()), watching: watchStatus() });
}

/** Change the watcher intervals. The watcher uses them from its next tick. */
export async function PUT(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, settingsSchema);
  if ('response' in body) {
    return body.response;
  }
  return json({ ...(await updateSettings(body.data)), watching: watchStatus() });
}
