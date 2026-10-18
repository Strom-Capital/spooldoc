import 'server-only';

import { eq } from 'drizzle-orm';
import { jobSpecSchema, type JobSpec } from '@/lib/job-spec';
import type { DraftStore } from './chat';
import { getDb, type Tx } from './db';
import { jobs } from './db/schema';
import { getJobRow, type JobRow } from './jobs';
import { UUID } from './servers';

/**
 * A job row locked until the transaction ends, so a read-change-write of its draft
 * cannot drop a change another request made in between. Null when there is no such job.
 */
export async function lockJobRow(tx: Tx, jobId: string): Promise<JobRow | null> {
  if (!UUID.test(jobId)) {
    return null;
  }
  const [row] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
  return row ?? null;
}

/** Change one part of a job's draft, reading the latest draft first. */
export async function updateDraft(jobId: string, change: (draft: JobSpec) => JobSpec): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = await lockJobRow(tx, jobId);
    if (!row) {
      throw new Error('The job is gone.');
    }
    const draft = change(jobSpecSchema.parse(row.draft));
    await tx.update(jobs).set({ draft }).where(eq(jobs.id, jobId));
  });
}

/** The chat tools' view of a job's draft. */
export function draftStore(jobId: string): DraftStore {
  const read = async (): Promise<JobSpec> => {
    const row = await getJobRow(jobId);
    if (!row) {
      throw new Error('The job is gone.');
    }
    return jobSpecSchema.parse(row.draft);
  };
  return {
    readDefinition: async () => (await read()).extract.definition,
    readTemplate: async () => (await read()).render.template,
    writeDefinition: (yaml) => updateDraft(jobId, (draft) => ({ ...draft, extract: { ...draft.extract, definition: yaml } })),
    writeTemplate: (html) => updateDraft(jobId, (draft) => ({ ...draft, render: { ...draft.render, template: html } })),
  };
}
