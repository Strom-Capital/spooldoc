import 'server-only';

import { eq } from 'drizzle-orm';
import { jobSpecSchema, withContent, type JobTemplate, type JobSpec } from '@/lib/job-spec';
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
 * The chat tools' view of a job's draft: its definition and its templates.
 *
 * @param userId - Who is chatting, recorded on the Word template files the agent makes
 */
export function draftStore(jobId: string, userId: string | null = null): DraftStore {
  const read = async (): Promise<JobSpec> => {
    const row = await getJobRow(jobId);
    if (!row) {
      throw new Error('The job is gone.');
    }
    return jobSpecSchema.parse(row.draft);
  };
  const changeTemplates = async (change: (templates: JobTemplate[]) => JobTemplate[]): Promise<JobTemplate[]> => {
    let saved: JobTemplate[] = [];
    await updateDraft(jobId, (draft) => {
      // Parsed again, so a change the schema refuses (no templates, a bad name) is not saved.
      saved = jobSpecSchema.shape.render.parse({ templates: change(draft.render.templates) }).templates;
      return { ...draft, render: { templates: saved } };
    });
    return saved;
  };
  return {
    readDefinition: async () => (await read()).extract.definition,
    readTemplates: async () => (await read()).render.templates,
    writeDefinition: (yaml) => updateDraft(jobId, (draft) => ({ ...draft, extract: { ...draft.extract, definition: yaml } })),
    writeHtml: async (templateId, html) => {
      await changeTemplates((templates) => {
        if (!templates.some((template) => template.id === templateId)) {
          throw new Error('The template is gone.');
        }
        return templates.map((template) => (template.id === templateId ? withContent(template, { kind: 'html', source: html }) : template));
      });
    },
    changeTemplates,
    writeWordTemplate: (templateId, file) =>
      getDb().transaction(async (tx) => {
        const row = await lockJobRow(tx, jobId);
        if (!row) {
          throw new Error('The job is gone.');
        }
        const draft = jobSpecSchema.parse(row.draft);
        const template = draft.render.templates.find((t) => t.id === templateId);
        if (!template) {
          throw new Error('The template is gone.');
        }
        if (template.kind === 'xlsx') {
          throw new Error(`The ${template.name} template is an Excel template. The agent can't write Excel files yet: the user changes it in Excel and uploads it.`);
        }
        if (template.kind === 'html' && template.source !== null) {
          throw new Error(
            `The ${template.name} template has HTML of its own. Ask the user to switch it to a Word template in the app first, or to add a Word template (add_template with kind docx).`,
          );
        }
        const saved = await storeTemplateFile(tx, { ...file, userId, madeBy: 'assistant' });
        const templates = draft.render.templates.map((t) => (t.id === templateId ? withContent(t, { kind: 'docx', fileId: saved.id }) : t));
        await tx.update(jobs).set({ draft: { ...draft, render: { templates } } }).where(eq(jobs.id, jobId));
        return templateFileView(saved);
      }),
  };
}
