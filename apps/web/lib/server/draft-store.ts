import 'server-only';

import { eq } from 'drizzle-orm';
import { jobSpecSchema, type JobSpec } from '@/lib/job-spec';
import type { DraftStore } from './chat';
import { getDb } from './db';
import { jobs } from './db/schema';
import { getJobRow } from './jobs';

/** Change one part of a job's draft, reading the latest draft first. */
export async function updateDraft(jobId: string, change: (draft: JobSpec) => JobSpec): Promise<void> {
  const row = await getJobRow(jobId);
  if (!row) {
    throw new Error('The job is gone.');
  }
  const draft = change(jobSpecSchema.parse(row.draft));
  await getDb().update(jobs).set({ draft }).where(eq(jobs.id, jobId));
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
