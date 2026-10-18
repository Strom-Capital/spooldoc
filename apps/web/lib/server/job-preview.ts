import 'server-only';

import type { Sample } from '@spooldoc/core';
import { jobSpecSchema, type JobSpec } from '@/lib/job-spec';
import type { JobRow } from './jobs';
import { getSample } from './samples';

/** The draft of a job and its preview sample (null when none is picked or it is gone). */
export async function draftAndSample(job: JobRow, sampleId?: string): Promise<{ draft: JobSpec; sample: Sample | null }> {
  const draft = jobSpecSchema.parse(job.draft);
  const id = sampleId ?? draft.preview.sampleId;
  return { draft, sample: id ? await getSample(id) : null };
}
