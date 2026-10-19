import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { ConfirmDeleteError, getJobRow, IncompleteJobError, jobDetail, saveVersion } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const saveSchema = z.object({
  note: z.string().trim().max(500).default(''),
  activate: z.boolean().default(true),
  /** Set once the user confirmed that the version starts deleting spooled files. */
  confirmDelete: z.boolean().default(false),
});

/** The job's versions, newest first. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getJobRow((await params).id);
  return row ? json({ versions: (await jobDetail(row)).versions }) : errorResponse(404, 'Job not found.');
}

/**
 * Save the draft as the next version, and by default make it active. A version that would
 * start deleting spooled files is not saved without `confirmDelete`: the answer is 409
 * with `confirm: 'delete'` and the message to confirm.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getJobRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, saveSchema);
  if ('response' in body) {
    return body.response;
  }
  try {
    const number = await saveVersion(row, { ...body.data, userId: auth.user.id });
    const updated = await getJobRow(row.id);
    return json({ number, job: await jobDetail(updated!) }, { status: 201 });
  } catch (error) {
    if (error instanceof IncompleteJobError) {
      return Response.json({ error: 'The job is not complete yet.', problems: error.problems }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof ConfirmDeleteError) {
      return json({ error: error.message, confirm: 'delete', queue: error.queue }, { status: 409 });
    }
    throw error;
  }
}
