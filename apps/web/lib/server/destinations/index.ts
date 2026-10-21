import 'server-only';

import type { DocumentData } from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { emailConfigSchema, ifsConfigSchema } from '@/lib/destination-config';
import type { EmailSpec } from '@/lib/job-spec';
import type { DestinationView } from '@/lib/types';
import { getDb } from '../db';
import { destinations } from '../db/schema';
import { emailDestination } from './email';
import { ifsDestination } from './ifs';
import { nFiles, storeRunFiles, type RunFile } from './store';

export { storeRunFiles, type RunFile } from './store';

/** A document of a run: its data, for a destination that fills in fields, such as email. */
export interface RunDocument {
  /** The page group; null for the document of the whole spooled file. */
  pageGroupIndex: number | null;
  /** The document's file name without extension, such as `invoice-260101`. */
  name: string;
  data: DocumentData;
  /** The HTML of the job's email body template for this document, when the email's message is one. */
  html?: string | null;
}

/** What a destination gets to deliver a run. */
export interface DeliverInput {
  runId: string;
  files: RunFile[];
  /** Every document of the run, in page group order; the whole spooled file's document last. */
  documents: RunDocument[];
  /** The job and the spooled file, for a destination that remembers what it delivered. */
  job: { id: string; splfKey: string };
  destinationId: string;
  /** The job's email part, for an email destination. */
  email: EmailSpec | null;
  /** The open connection of the job's server, and its host. */
  conn: Connection;
  host: string;
  /** Keep a secret, such as a password, out of the run's errors. */
  addSecret(secret: string): void;
}

/** Where a run's documents go. New kinds (SFTP, S3, webhook) implement this. */
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
  email: (config) => emailDestination(emailConfigSchema.parse(config)),
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
  if (row.kind === 'email') {
    const parsed = emailConfigSchema.safeParse(row.config);
    return { ...base, kind: 'email', config: parsed.success ? parsed.data : { testAddress: null } };
  }
  return { ...base, kind: 'spooldoc', config: {} };
}
