import { spooledFileIdSchema } from '@spooldoc/core';
import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { sampleView } from '@/lib/server/render';
import { capture } from '@/lib/server/samples';

export const dynamic = 'force-dynamic';

const OBJECT_NAME = /^[A-Za-z0-9$#@_.]{1,10}$/;

/**
 * Read one spooled file of the queue to show its pages, given `name`, `number`,
 * `jobName`, `jobUser` and `jobNumber`. This only reads: nothing is stored, and the file
 * is never held, moved or deleted.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; lib: string; name: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, lib, name } = await params;
  if (!OBJECT_NAME.test(lib) || !OBJECT_NAME.test(name)) {
    return errorResponse(400, 'Invalid library or queue name.');
  }
  const search = new URL(request.url).searchParams;
  const missing = ['splf', 'number', 'jobName', 'jobUser', 'jobNumber'].some((key) => !search.get(key));
  const splf = spooledFileIdSchema.safeParse({
    name: search.get('splf') ?? '',
    number: Number(search.get('number') ?? ''),
    jobName: search.get('jobName') ?? '',
    jobUser: search.get('jobUser') ?? '',
    jobNumber: search.get('jobNumber') ?? '',
  });
  if (missing || !splf.success) {
    return errorResponse(400, 'Give the spooled file as splf, number, jobName, jobUser and jobNumber.');
  }
  return withConnection(id, async (conn, server) => {
    let captured;
    try {
      captured = await capture(conn, server.host, splf.data);
    } catch (error) {
      if (error instanceof Error && error.name === 'UnsupportedCodePageError') {
        return errorResponse(422, `${error.message}. Set SPOOLDOC_DEFAULT_CCSID to decode it anyway.`);
      }
      throw error;
    }
    const queue = captured.sample.attributes.queue;
    if (queue.library.toUpperCase() !== lib.toUpperCase() || queue.name.toUpperCase() !== name.toUpperCase()) {
      return errorResponse(404, `That spooled file is on ${queue.library}/${queue.name}, not ${lib}/${name}.`);
    }
    return json({ sample: sampleView(captured.sample), warnings: captured.warnings });
  });
}
