import type { JobSummary } from '@/lib/types';
import { api } from './api';

/** Create a job reading from a queue and return its id. */
export async function createJob(source: { serverId?: string; library?: string; queue?: string } = {}): Promise<string> {
  const { id } = await api<{ id: string }>('/api/jobs', { method: 'POST', body: source });
  return id;
}

/** The other jobs that run files from a queue, split by how they run. */
export interface SameQueueJobs {
  /** Jobs whose active version watches the queue and that are not paused. */
  watching: JobSummary[];
  /** Jobs whose active version runs on demand. */
  onDemand: JobSummary[];
}

/** The jobs other than `jobId` whose active version reads the source queue. */
export function sameQueueJobs(
  jobs: JobSummary[],
  jobId: string,
  source: { serverId: string | null; library: string; queue: string },
): SameQueueJobs {
  const others = jobs.filter(
    (other) =>
      other.id !== jobId &&
      other.activeVersion !== null &&
      other.source.serverId === source.serverId &&
      other.source.library === source.library &&
      other.source.queue === source.queue,
  );
  return {
    watching: others.filter((other) => other.mode === 'watch' && !other.paused),
    onDemand: others.filter((other) => other.mode === 'manual'),
  };
}

/** How a job runs, in the Jobs page's words: Watching, Paused, On demand or Draft only. */
export function jobState(job: Pick<JobSummary, 'mode' | 'paused' | 'activeVersion'>): string {
  if (job.activeVersion === null) return 'Draft only';
  if (job.mode === 'watch') return job.paused ? 'Paused' : 'Watching';
  return 'On demand';
}
