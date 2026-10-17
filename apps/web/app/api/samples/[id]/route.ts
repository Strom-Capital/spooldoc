import { checkFetchSite, errorResponse, json, workspaceErrorResponse } from '@/lib/server/http';
import { sampleView } from '@/lib/server/render';
import { getWorkspace } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';

/** One sample without its raw bytes. */
export async function GET(request: Request, ctx: RouteContext<'/api/samples/[id]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const { id } = await ctx.params;
  try {
    const sample = await getWorkspace().readSample(id);
    if (!sample) {
      return errorResponse(404, `Sample ${id} not found.`);
    }
    return json(sampleView(sample));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
