import { z } from 'zod';
import { checkOrigin, errorResponse, json, readJson, workspaceErrorResponse } from '@/lib/server/http';
import { linkDefinition } from '@/lib/server/samples';
import { TYPE_NAME } from '@/lib/server/workspace';

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
    if (!(await linkDefinition(id, body.data.type))) {
      return errorResponse(404, `Sample ${id} not found.`);
    }
    return json({ ok: true });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
