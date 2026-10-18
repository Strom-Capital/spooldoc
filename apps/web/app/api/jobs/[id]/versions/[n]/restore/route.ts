import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { getJobRow, jobDetail, restoreVersion } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

/** Copy a version into the draft. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, n } = await params;
  const row = await getJobRow(id);
  const number = Number(n);
  if (!row || !Number.isInteger(number) || !(await restoreVersion(row, number))) {
    return errorResponse(404, 'Version not found.');
  }
  return json(await jobDetail((await getJobRow(row.id))!));
}
