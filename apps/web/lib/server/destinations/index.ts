import 'server-only';

import { eq } from 'drizzle-orm';
import type { Tx } from '../db';
import { destinations, runFiles } from '../db/schema';
import { getDb } from '../db';

/** A file a destination receives. */
export interface RunFile {
  pageGroupIndex: number;
  /** The name of the job template the file was rendered with, and its place in the job's templates. */
  template: string;
  templateIndex: number;
  name: string;
  contentType: string;
  content: Uint8Array;
}

/** Where a run's documents go. New kinds (SFTP, S3, IFS, email, webhook) implement this. */
export interface Destination {
  kind: string;
  /**
   * Deliver every file of a run. Called inside the run's transaction where the
   * destination stores in the database, so the run and its files are saved together.
   */
  deliver(input: { runId: string; files: RunFile[]; tx: Tx }): Promise<void>;
}

/** The built-in destination: PDFs kept in Spooldoc's database for download. */
export const spooldocDestination: Destination = {
  kind: 'spooldoc',
  async deliver({ runId, files, tx }) {
    if (files.length === 0) {
      return;
    }
    await tx.insert(runFiles).values(
      files.map((file) => ({
        runId,
        pageGroupIndex: file.pageGroupIndex,
        template: file.template,
        templateIndex: file.templateIndex,
        name: file.name,
        contentType: file.contentType,
        size: file.content.byteLength,
        content: Buffer.from(file.content),
      })),
    );
  },
};

const KINDS: Record<string, Destination> = { spooldoc: spooldocDestination };

/** The destination behind a destination row, or null for an unknown id or kind. */
export async function destinationFor(id: string | null): Promise<Destination | null> {
  if (!id) {
    return null;
  }
  const [row] = await getDb().select({ kind: destinations.kind }).from(destinations).where(eq(destinations.id, id));
  return row ? (KINDS[row.kind] ?? null) : null;
}
