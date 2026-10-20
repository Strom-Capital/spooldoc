import { describe, expect, it } from 'vitest';
import { sameQueueJobs } from '@/lib/client/jobs';
import type { JobSummary } from '@/lib/types';

const SERVER = '00000000-0000-4000-8000-000000000001';
const source = { serverId: SERVER, library: 'MYLIB', queue: 'MYOUTQ' };

function job(id: string, fields: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    name: id.toUpperCase(),
    source: { ...source, serverName: 'ibmi.example.com' },
    mode: 'manual',
    finish: 'hold',
    paused: false,
    activeVersion: 1,
    versions: 1,
    lastWatchAt: null,
    lastWatchError: null,
    broken: null,
    lastRun: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  };
}

describe('sameQueueJobs', () => {
  it('splits the other jobs on the queue into watching and on demand', () => {
    const jobs = [job('self'), job('watcher', { mode: 'watch' }), job('manual')];
    const others = sameQueueJobs(jobs, 'self', source);
    expect(others.watching.map((j) => j.id)).toEqual(['watcher']);
    expect(others.onDemand.map((j) => j.id)).toEqual(['manual']);
  });

  it('leaves out other queues, jobs without a version and paused watchers', () => {
    const jobs = [
      job('other-queue', { source: { ...source, queue: 'OTHEROUTQ', serverName: null } }),
      job('other-library', { source: { ...source, library: 'OTHERLIB', serverName: null } }),
      job('no-version', { activeVersion: null }),
      job('paused', { mode: 'watch', paused: true }),
    ];
    expect(sameQueueJobs(jobs, 'self', source)).toEqual({ watching: [], onDemand: [] });
  });
});
