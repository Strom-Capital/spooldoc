import 'server-only';

import { getDb } from '../db';
import { runFiles } from '../db/schema';

/** A file a destination receives. */
export interface RunFile {
  /** The page group the file is the document of; null for a file of the whole spooled file. */
  pageGroupIndex: number | null;
  /** The name of the job template the file was rendered with, and its place in the job's templates. */
  template: string;
  templateIndex: number;
  name: string;
  contentType: string;
  content: Uint8Array;
}

/** "1 file", "3 files". */
export const nFiles = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * Keep a run's files in Spooldoc's database, for download from the Job log. They are
 * saved in one transaction, so a run has all of its files or none.
 */
export async function storeRunFiles(runId: string, files: RunFile[]): Promise<void> {
  if (files.length === 0) {
    return;
  }
  await getDb().transaction(async (tx) => {
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
  });
}
