import 'server-only';

import { eq } from 'drizzle-orm';
import { AI_PROVIDER_IDS, type AiProviderId, type Effort } from '../ai-providers';
import type { AiSettingsView } from '../types';
import { getDb } from './db';
import { aiProviders, settings } from './db/schema';
import { encryptSecret } from './secrets';

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

/** A change to the chat model: which provider the chat uses, and that provider's settings. */
export interface AiChange {
  /** Null turns the chat off and keeps every provider's settings. */
  provider: AiProviderId | null;
  model?: string;
  effort?: Effort;
  baseUrl?: string;
  /** A new key. Missing or empty keeps the saved key; null removes it. */
  apiKey?: string | null;
  /** Mask values before page text and tool results go to the model. Missing keeps the setting. */
  mask?: boolean;
}

/** The chosen provider, whether values are masked, and each provider's row, keys still encrypted. */
export async function getAiRows(): Promise<{ provider: AiProviderId | null; mask: boolean; rows: (typeof aiProviders.$inferSelect)[] }> {
  const db = getDb();
  const [row] = await db.select({ aiProvider: settings.aiProvider, aiMask: settings.aiMask }).from(settings).where(eq(settings.id, 1));
  const rows = await db.select().from(aiProviders);
  return { provider: (row?.aiProvider ?? null) as AiProviderId | null, mask: row?.aiMask ?? false, rows };
}

/** True when values are masked before page text and tool results go to the model (Settings, AI model). */
export async function maskingOn(): Promise<boolean> {
  const [row] = await getDb().select({ aiMask: settings.aiMask }).from(settings).where(eq(settings.id, 1));
  return row?.aiMask ?? false;
}

/** The chat model settings without any key. */
export async function getAiSettings(): Promise<AiSettingsView> {
  const { provider, mask, rows } = await getAiRows();
  const providers = Object.fromEntries(
    AI_PROVIDER_IDS.map((id) => {
      const row = rows.find((entry) => entry.provider === id);
      return [id, { model: row?.model ?? null, effort: (row?.effort ?? 'provider-default') as Effort, baseUrl: row?.baseUrl ?? null, hasKey: !!row?.apiKeyEnc }];
    }),
  ) as AiSettingsView['providers'];
  return { provider, mask, providers };
}

/** Choose the chat's provider and save that provider's settings. The key is stored encrypted. */
export async function updateAiSettings(change: AiChange): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (change.provider) {
      const values: Partial<typeof aiProviders.$inferInsert> = {};
      if (change.model !== undefined) values.model = change.model;
      if (change.effort !== undefined) values.effort = change.effort;
      if (change.baseUrl !== undefined) values.baseUrl = change.baseUrl;
      if (change.apiKey === null) values.apiKeyEnc = null;
      else if (change.apiKey) values.apiKeyEnc = encryptSecret(change.apiKey);
      const insert = tx.insert(aiProviders).values({ provider: change.provider, ...values });
      await (Object.keys(values).length > 0 ? insert.onConflictDoUpdate({ target: aiProviders.provider, set: values }) : insert.onConflictDoNothing());
    }
    const set = { aiProvider: change.provider, ...(change.mask !== undefined ? { aiMask: change.mask } : {}) };
    await tx
      .insert(settings)
      .values({ id: 1, ...DEFAULT_SETTINGS, ...set })
      .onConflictDoUpdate({ target: settings.id, set });
  });
}
