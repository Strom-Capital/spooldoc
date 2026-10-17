import { z } from 'zod';
import { checkFetchSite, checkOrigin, json, readJson, workspaceErrorResponse } from '@/lib/server/http';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const previewRequest = z.object({
  yaml: z.string().max(MAX_TEXT).optional(),
  html: z.string().max(MAX_TEXT).optional(),
  document: z.number().int().nonnegative().optional(),
});

const documentParam = (request: Request): number | undefined => {
  const value = Number(new URL(request.url).searchParams.get('document') ?? '');
  return Number.isInteger(value) && value >= 0 ? value : undefined;
};

/** Render a sample with its saved definition and template. `?document=n` picks the document. */
export async function GET(request: Request, ctx: RouteContext<'/api/render/[id]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const { id } = await ctx.params;
  try {
    return json(await renderSample(id, { document: documentParam(request) }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

/** Render a sample with unsaved definition YAML or template HTML from the editors. */
export async function POST(request: Request, ctx: RouteContext<'/api/render/[id]'>): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const body = await readJson(request, previewRequest);
  if ('response' in body) {
    return body.response;
  }
  const { id } = await ctx.params;
  try {
    return json(await renderSample(id, body.data));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
