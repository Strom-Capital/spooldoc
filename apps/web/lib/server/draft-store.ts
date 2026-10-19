import 'server-only';

import { eq } from 'drizzle-orm';
import { jobSpecSchema, withTemplate, type JobOutput, type JobSpec } from '@/lib/job-spec';
import type { DraftStore } from './chat';
import { getDb, type Tx } from './db';
import { jobs } from './db/schema';
import { getJobRow, type JobRow } from './jobs';
import { UUID } from './servers';
import { storeTemplateFile, templateFileView } from './template-files';

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

/**
 * The chat tools' view of a job's draft: its definition and its outputs.
 *
 * @param userId - Who is chatting, recorded on the Word template files the assistant makes
 */
export function draftStore(jobId: string, userId: string | null = null): DraftStore {
  const read = async (): Promise<JobSpec> => {
    const row = await getJobRow(jobId);
    if (!row) {
      throw new Error('The job is gone.');
    }
    return jobSpecSchema.parse(row.draft);
  };
  const changeOutputs = async (change: (outputs: JobOutput[]) => JobOutput[]): Promise<JobOutput[]> => {
    let saved: JobOutput[] = [];
    await updateDraft(jobId, (draft) => {
      // Parsed again, so a change the schema refuses (no outputs, a bad label) is not saved.
      saved = jobSpecSchema.shape.render.parse({ outputs: change(draft.render.outputs) }).outputs;
      return { ...draft, render: { outputs: saved } };
    });
    return saved;
  };
  return {
    readDefinition: async () => (await read()).extract.definition,
    readOutputs: async () => (await read()).render.outputs,
    writeDefinition: (yaml) => updateDraft(jobId, (draft) => ({ ...draft, extract: { ...draft.extract, definition: yaml } })),
    writeTemplate: async (outputId, html) => {
      await changeOutputs((outputs) => {
        if (!outputs.some((output) => output.id === outputId)) {
          throw new Error('The output is gone.');
        }
        return outputs.map((output) => (output.id === outputId ? { ...output, template: { kind: 'html', source: html } } : output));
      });
    },
    changeOutputs,
    writeWordTemplate: (outputId, file) =>
      getDb().transaction(async (tx) => {
        const row = await lockJobRow(tx, jobId);
        if (!row) {
          throw new Error('The job is gone.');
        }
        const draft = jobSpecSchema.parse(row.draft);
        const output = draft.render.outputs.find((o) => o.id === outputId);
        if (!output) {
          throw new Error('The output is gone.');
        }
        if (output.template.kind === 'html' && output.template.source !== null) {
          throw new Error(
            `The ${output.label} output has an HTML template of its own. Ask the user to switch it to a Word template in the app first, or to add a Word output (add_output with kind docx).`,
          );
        }
        const saved = await storeTemplateFile(tx, { ...file, userId, madeBy: 'assistant' });
        const outputs = draft.render.outputs.map((o) => (o.id === outputId ? withTemplate(o, { kind: 'docx', fileId: saved.id }) : o));
        await tx.update(jobs).set({ draft: { ...draft, render: { outputs } } }).where(eq(jobs.id, jobId));
        return templateFileView(saved);
      }),
  };
}
