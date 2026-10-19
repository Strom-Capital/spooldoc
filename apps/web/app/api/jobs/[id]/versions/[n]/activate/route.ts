import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { activateVersion, ConfirmDeleteError, getJobRow, jobDetail } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

/** The body is optional: `confirmDelete` once the user confirmed that the version starts deleting spooled files. */
const activateSchema = z.object({ confirmDelete: z.boolean().default(false) });

/**
 * Make a version the one runs and the watcher use. A version that would start deleting
 * spooled files is not made active without `confirmDelete`: the answer is 409 with
 * `confirm: 'delete'` and the message to confirm.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const text = await request.text();
  let raw: unknown = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return errorResponse(400, 'The request body is not JSON.');
  }
  const body = activateSchema.safeParse(raw);
  if (!body.success) {
    return errorResponse(400, 'Invalid request.');
  }
  const { id, n } = await params;
  const row = await getJobRow(id);
  const number = Number(n);
  try {
    if (!row || !Number.isInteger(number) || !(await activateVersion(row, number, body.data))) {
      return errorResponse(404, 'Version not found.');
    }
  } catch (error) {
    if (error instanceof ConfirmDeleteError) {
      return json({ error: error.message, confirm: 'delete', queue: error.queue }, { status: 409 });
    }
    throw error;
  }
  return json(await jobDetail((await getJobRow(row.id))!));
}
