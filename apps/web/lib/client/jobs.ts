import { api } from './api';

/** Create a job reading from a queue and return its id. */
export async function createJob(source: { serverId?: string; library?: string; queue?: string } = {}): Promise<string> {
  const { id } = await api<{ id: string }>('/api/jobs', { method: 'POST', body: source });
  return id;
}
