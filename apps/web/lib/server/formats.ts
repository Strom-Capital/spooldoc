import 'server-only';

import { eq } from 'drizzle-orm';
import { DATE_FORMATS, DEFAULT_FORMATS, NUMBER_LANGS, type DateFormat, type Formats, type NumberLang } from '../formats';
import { getDb } from './db';
import { settings } from './db/schema';
import { DEFAULT_SETTINGS } from './settings';

/** The Formats section of Settings: how numbers, amounts and dates print. */
export async function getFormats(): Promise<Formats> {
  const [row] = await getDb()
    .select({ numberFormat: settings.numberFormat, dateFormat: settings.dateFormat, currency: settings.currency })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!row) return DEFAULT_FORMATS;
  return {
    numberFormat: NUMBER_LANGS.includes(row.numberFormat as NumberLang) ? (row.numberFormat as NumberLang) : DEFAULT_FORMATS.numberFormat,
    dateFormat: DATE_FORMATS.includes(row.dateFormat as DateFormat) ? (row.dateFormat as DateFormat) : DEFAULT_FORMATS.dateFormat,
    currency: row.currency,
  };
}

/** Change the formats. Documents and emails use them from the next render. */
export async function updateFormats(formats: Formats): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...formats })
    .onConflictDoUpdate({ target: settings.id, set: formats });
}
