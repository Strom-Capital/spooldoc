import 'server-only';

import { eq } from 'drizzle-orm';
import type { Tx } from '../db';
import { destinations, runOutputs } from '../db/schema';
import { getDb } from '../db';

/** A file a destination receives. */
export interface OutputFile {
  documentIndex: number;
  /** The label of the job output the file was rendered for, and its place in the job's outputs. */
  output: string;
  outputIndex: number;
  name: string;
  contentType: string;
  content: Uint8Array;
}

/** Where a run's documents go. New kinds (SFTP, S3, IFS, email, webhook) implement this. */
export interface Destination {
  kind: string;
  /**
   * Deliver every file of a run. Called inside the run's transaction where the
   * destination stores in the database, so the run and its outputs are saved together.
   */
  deliver(input: { runId: string; files: OutputFile[]; tx: Tx }): Promise<void>;
}

/** The built-in destination: PDFs kept in Spooldoc's database for download. */
export const spooldocDestination: Destination = {
  kind: 'spooldoc',
  async deliver({ runId, files, tx }) {
    if (files.length === 0) {
      return;
    }
    await tx.insert(runOutputs).values(
      files.map((file) => ({
        runId,
        documentIndex: file.documentIndex,
        output: file.output,
        outputIndex: file.outputIndex,
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
