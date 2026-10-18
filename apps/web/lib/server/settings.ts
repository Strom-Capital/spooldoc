import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { settings } from './db/schema';

/** The watcher intervals. */
export interface WatchSettings {
  pollSeconds: number;
  safetyCheckSeconds: number;
}

export const DEFAULT_SETTINGS: WatchSettings = { pollSeconds: 30, safetyCheckSeconds: 300 };

/** The settings row (the migration creates it; defaults if it is missing). */
export async function getSettings(): Promise<WatchSettings> {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1));
  return row ? { pollSeconds: row.pollSeconds, safetyCheckSeconds: row.safetyCheckSeconds } : DEFAULT_SETTINGS;
}

/** Change the settings. */
export async function updateSettings(change: Partial<WatchSettings>): Promise<WatchSettings> {
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...change })
    .onConflictDoUpdate({ target: settings.id, set: change });
  return getSettings();
}
