import 'server-only';

import type { Connection } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { ifsConfigSchema } from '@/lib/destination-config';
import type { DestinationView } from '@/lib/types';
import { getDb } from '../db';
import { destinations } from '../db/schema';
import { ifsDestination } from './ifs';
import { nFiles, storeRunFiles, type RunFile } from './store';

export { storeRunFiles, type RunFile } from './store';

/** What a destination gets to deliver a run. */
export interface DeliverInput {
  runId: string;
  files: RunFile[];
  /** The open connection of the job's server, and its host. */
  conn: Connection;
  host: string;
}

/** Where a run's documents go. New kinds (SFTP, S3, email, webhook) implement this. */
export interface Destination {
  kind: string;
  /**
   * Deliver every file of a run. Runs outside any database transaction, since it may write
   * to another system; `storeRunFiles` saves files in one transaction of its own.
   *
   * @returns The deliver step's note, such as "Kept 3 files in Spooldoc"
   */
  deliver(input: DeliverInput): Promise<string>;
}

/** The built-in destination: files kept in Spooldoc's database for download. */
export const spooldocDestination: Destination = {
  kind: 'spooldoc',
  async deliver({ runId, files }) {
    await storeRunFiles(runId, files);
    return `Kept ${nFiles(files.length)} in Spooldoc`;
  },
};

/** Builds the destination of each kind from its saved settings. */
const KINDS: Record<string, (config: unknown) => Destination> = {
  spooldoc: () => spooldocDestination,
  ifs: (config) => ifsDestination(ifsConfigSchema.parse(config)),
};

/**
 * The destination behind a destination row, or null for an unknown id or kind.
 *
 * @throws Error when the saved settings are not valid for the kind
 */
export async function destinationFor(id: string | null): Promise<Destination | null> {
  if (!id) {
    return null;
  }
  const [row] = await getDb().select({ kind: destinations.kind, name: destinations.name, config: destinations.config }).from(destinations).where(eq(destinations.id, id));
  const build = row ? KINDS[row.kind] : undefined;
  if (!row || !build) {
    return null;
  }
  try {
    return build(row.config);
  } catch {
    throw new Error(`The settings of the destination ${row.name} are not valid. Open it on the Destinations page and save it again.`);
  }
}

/**
 * A destination row as the pages see it. IFS settings that are not valid show their folder
 * with the default choices, so the page can still list the destination and save it again.
 */
export function destinationView(row: typeof destinations.$inferSelect, jobs: DestinationView['jobs']): DestinationView {
  const base = { id: row.id, name: row.name, builtin: row.builtin, jobs };
  if (row.kind === 'ifs') {
    const parsed = ifsConfigSchema.safeParse(row.config);
    const config = parsed.success ? parsed.data : { folder: String(row.config.folder ?? ''), ifExists: 'replace' as const, keepCopy: true };
    return { ...base, kind: 'ifs', config };
  }
  return { ...base, kind: 'spooldoc', config: {} };
}
