import { guard } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { listRuns } from '@/lib/server/runs';
import type { RunStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES = new Set<RunStatus>(['running', 'success', 'warning', 'failed', 'skipped']);

const date = (value: string | null): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** The job log: runs newest first, filtered by `job`, `status`, `from` and `to`, paged with `before`. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const search = new URL(request.url).searchParams;
  const status = search.get('status') as RunStatus | null;
  const before = Number(search.get('before') ?? '');
  const limit = Number(search.get('limit') ?? '');
  return json(
    await listRuns({
      jobId: search.get('job') ?? undefined,
      status: status && STATUSES.has(status) ? status : undefined,
      from: date(search.get('from')),
      to: date(search.get('to')),
      before: Number.isInteger(before) && before > 0 ? before : undefined,
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    }),
  );
}
