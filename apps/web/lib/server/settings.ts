import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { settings } from './db/schema';

/** The watcher intervals and how long runs are kept. */
export interface AppSettings {
  pollSeconds: number;
  safetyCheckSeconds: number;
  retentionDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = { pollSeconds: 30, safetyCheckSeconds: 300, retentionDays: 90 };

/** The settings row (the migration creates it; defaults if it is missing). */
export async function getSettings(): Promise<AppSettings> {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1));
  return row ? { pollSeconds: row.pollSeconds, safetyCheckSeconds: row.safetyCheckSeconds, retentionDays: row.retentionDays } : DEFAULT_SETTINGS;
}

/** Change the settings. */
export async function updateSettings(change: Partial<AppSettings>): Promise<AppSettings> {
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...change })
    .onConflictDoUpdate({ target: settings.id, set: change });
  return getSettings();
}
