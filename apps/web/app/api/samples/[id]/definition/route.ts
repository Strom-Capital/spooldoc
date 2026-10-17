import { z } from 'zod';
import { checkOrigin, errorResponse, json, readJson, workspaceErrorResponse } from '@/lib/server/http';
import { getWorkspace, TYPE_NAME } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';

const linkRequest = z.object({
  type: z.string().regex(TYPE_NAME, 'use lowercase letters, digits and dashes').max(64),
});

/** Link a sample to a definition type. The definition file does not have to exist yet. */
export async function POST(request: Request, ctx: RouteContext<'/api/samples/[id]/definition'>): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const body = await readJson(request, linkRequest);
  if ('response' in body) {
    return body.response;
  }
  const { id } = await ctx.params;
  try {
    const ws = getWorkspace();
    const sample = await ws.readSample(id);
    if (!sample) {
      return errorResponse(404, `Sample ${id} not found.`);
    }
    await ws.writeSample({ ...sample, definition: body.data.type });
    return json({ ok: true });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
