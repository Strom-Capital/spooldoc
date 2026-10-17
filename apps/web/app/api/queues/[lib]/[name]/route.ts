import { checkFetchSite, errorResponse, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';

export const dynamic = 'force-dynamic';

const OBJECT_NAME = /^[A-Za-z0-9$#@_.]{1,10}$/;

/** Spooled files of one output queue, newest first, filtered by `name` and `userData` ("contains"). */
export async function GET(request: Request, ctx: RouteContext<'/api/queues/[lib]/[name]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const { lib, name } = await ctx.params;
  if (!OBJECT_NAME.test(lib) || !OBJECT_NAME.test(name)) {
    return errorResponse(400, 'Invalid library or queue name.');
  }
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get('limit') ?? '');
  const filter = {
    name: params.get('name')?.slice(0, 10) || undefined,
    userData: params.get('userData')?.slice(0, 10) || undefined,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
  };
  return withConnection(async (conn) => {
    const files = await conn.listSpooledFiles({ library: lib.toUpperCase(), name: name.toUpperCase() }, filter);
    return json({ files });
  });
}
