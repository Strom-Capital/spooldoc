import { and, eq } from 'drizzle-orm';
import { jobSpecSchema } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { jobVersions } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

/** One version's spec. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, n } = await params;
  const row = await getJobRow(id);
  const number = Number(n);
  if (!row || !Number.isInteger(number)) {
    return errorResponse(404, 'Version not found.');
  }
  const [version] = await getDb()
    .select()
    .from(jobVersions)
    .where(and(eq(jobVersions.jobId, row.id), eq(jobVersions.number, number)));
  if (!version) {
    return errorResponse(404, 'Version not found.');
  }
  return json({ number, note: version.note, createdAt: version.createdAt.toISOString(), spec: jobSpecSchema.parse(version.spec) });
}
