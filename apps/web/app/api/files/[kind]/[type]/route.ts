import { stat } from 'node:fs/promises';
import { parseDefinition, starterTemplate } from '@spooldoc/core';
import { z } from 'zod';
import { checkFetchSite, checkOrigin, errorResponse, json, readJson, workspaceErrorResponse } from '@/lib/server/http';
import { getWorkspace, TYPE_NAME } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';

type Kind = 'definitions' | 'templates';

const putRequest = z.object({ content: z.string().max(2_000_000) });

/** Checks the kind and the type name; returns them or a 400/404 response. */
async function target(ctx: RouteContext<'/api/files/[kind]/[type]'>): Promise<{ kind: Kind; type: string } | Response> {
  const { kind, type } = await ctx.params;
  if (kind !== 'definitions' && kind !== 'templates') {
    return errorResponse(404, 'Not found.');
  }
  if (!TYPE_NAME.test(type) || type.length > 64) {
    return errorResponse(400, 'Invalid type name: use lowercase letters, digits and dashes.');
  }
  return { kind, type };
}

async function updatedAt(path: string): Promise<string | null> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * A definition (`definitions/<type>.yaml`) or template (`templates/<type>.html`). A missing
 * template comes back as the starter template for the definition, with `generated: true`.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/files/[kind]/[type]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const t = await target(ctx);
  if (t instanceof Response) {
    return t;
  }
  try {
    const ws = getWorkspace();
    if (t.kind === 'definitions') {
      const content = await ws.readDefinition(t.type);
      if (content === null) {
        return errorResponse(404, `There is no definitions/${t.type}.yaml.`);
      }
      return json({ content, updatedAt: await updatedAt(ws.paths.definition(t.type)) });
    }
    const content = await ws.readTemplate(t.type);
    if (content !== null) {
      return json({ content, updatedAt: await updatedAt(ws.paths.template(t.type)) });
    }
    const yaml = await ws.readDefinition(t.type);
    if (yaml === null) {
      return errorResponse(404, `There is no templates/${t.type}.html.`);
    }
    try {
      return json({ content: starterTemplate(parseDefinition(yaml)), updatedAt: null, generated: true });
    } catch {
      return errorResponse(404, `There is no templates/${t.type}.html, and the definition is not valid.`);
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

/** Save a definition (checked with parseDefinition; 400 with the message when invalid) or a template. */
export async function PUT(request: Request, ctx: RouteContext<'/api/files/[kind]/[type]'>): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const t = await target(ctx);
  if (t instanceof Response) {
    return t;
  }
  const body = await readJson(request, putRequest);
  if ('response' in body) {
    return body.response;
  }
  const { content } = body.data;
  try {
    const ws = getWorkspace();
    if (t.kind === 'definitions') {
      let def;
      try {
        def = parseDefinition(content);
      } catch (error) {
        return errorResponse(400, error instanceof Error ? error.message : String(error));
      }
      if (def.type !== t.type) {
        return errorResponse(400, `The definition says type: ${def.type}, but it is saved as ${t.type}.`);
      }
      await ws.writeDefinition(t.type, content);
      return json({ content, updatedAt: await updatedAt(ws.paths.definition(t.type)) });
    }
    await ws.writeTemplate(t.type, content);
    return json({ content, updatedAt: await updatedAt(ws.paths.template(t.type)) });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
