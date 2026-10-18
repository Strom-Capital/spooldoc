import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { draftPatchSchema, jobSpecSchema } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { jobs } from '@/lib/server/db/schema';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { getJobRow, jobDetail } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    description: z.string().max(2000),
    /** Parts of the draft; each replaces that part, so editors of different parts do not overwrite each other. */
    draft: draftPatchSchema,
    paused: z.boolean(),
  })
  .partial();

/** A job with its draft and versions. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getJobRow((await params).id);
  return row ? json(await jobDetail(row)) : errorResponse(404, 'Job not found.');
}

/** Rename a job, change parts of its draft, or pause and resume watching. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getJobRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, patchSchema);
  if ('response' in body) {
    return body.response;
  }
  const change = body.data;
  if (Object.keys(change).length === 0) {
    return json(await jobDetail(row));
  }
  const { draft: patch, ...rest } = change;
  const values: Partial<typeof jobs.$inferInsert> = { ...rest };
  if (patch) {
    values.draft = jobSpecSchema.parse({ ...jobSpecSchema.parse(row.draft), ...patch });
  }
  // Resuming starts from now: files that arrived while paused are left for Run now.
  if (change.paused === false && row.paused) {
    values.watchSince = new Date();
    values.lastWatchAt = null;
    values.lastWatchError = null;
  }
  const [updated] = await getDb().update(jobs).set(values).where(eq(jobs.id, row.id)).returning();
  return json(await jobDetail(updated!));
}

/** Delete a job with its versions, runs and outputs. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getJobRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Job not found.');
  }
  await getDb().delete(jobs).where(eq(jobs.id, row.id));
  return new Response(null, { status: 204 });
}
