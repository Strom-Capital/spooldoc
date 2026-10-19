import 'server-only';

import { and, eq, ne } from 'drizzle-orm';
import { jobSpecSchema } from '@/lib/job-spec';
import { outputFiles, type JobFiles, type JobFilesReader } from './chat';
import { getDb } from './db';
import { jobs, jobVersions } from './db/schema';
import { getJobRow, type JobRow } from './jobs';
import { UUID } from './servers';

/** The job's definition and outputs from its active version when it has one, else from its draft. */
async function filesOf(row: JobRow): Promise<JobFiles> {
  let spec = jobSpecSchema.parse(row.draft);
  if (row.activeVersion !== null) {
    const [version] = await getDb()
      .select({ spec: jobVersions.spec })
      .from(jobVersions)
      .where(and(eq(jobVersions.jobId, row.id), eq(jobVersions.number, row.activeVersion)));
    if (version) {
      spec = jobSpecSchema.parse(version.spec);
    }
  }
  return { id: row.id, name: row.name, definitionYaml: spec.extract.definition, outputs: spec.render.outputs.map(outputFiles) };
}

/**
 * The definition and outputs of one job, from its active version or else its draft.
 * Null when there is no such job.
 */
export async function readJobFiles(id: string): Promise<JobFiles | null> {
  const row = await getJobRow(id);
  return row ? filesOf(row) : null;
}

/**
 * The chat tools' view of the other jobs: their definitions and outputs and nothing
 * else. Only jobs other than `jobId` are listed, and only files are read.
 */
export function jobFilesReader(jobId: string): JobFilesReader {
  return {
    list: async () => {
      const rows = await getDb().select().from(jobs).where(ne(jobs.id, jobId)).orderBy(jobs.name);
      return Promise.all(rows.map(filesOf));
    },
    read: async (id) => (UUID.test(id) && id !== jobId ? readJobFiles(id) : null),
  };
}
