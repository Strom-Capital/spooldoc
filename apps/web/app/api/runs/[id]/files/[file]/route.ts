import { and, eq } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { runOutputs } from '@/lib/server/db/schema';
import { errorResponse } from '@/lib/server/http';
import { UUID } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

/** Download a file a run delivered to Spooldoc. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, file } = await params;
  if (!UUID.test(id) || !UUID.test(file)) {
    return errorResponse(404, 'File not found.');
  }
  const [row] = await getDb()
    .select()
    .from(runOutputs)
    .where(and(eq(runOutputs.runId, id), eq(runOutputs.id, file)));
  if (!row) {
    return errorResponse(404, 'File not found.');
  }
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  return new Response(new Uint8Array(row.content), {
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(row.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${row.name.replace(/["\\\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
