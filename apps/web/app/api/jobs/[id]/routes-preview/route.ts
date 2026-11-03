import { documentName, spooledFileData, valueAt } from '@spooldoc/core';
import { z } from 'zod';
import { destinationSpecSchema, perSpooledFile } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { fieldTypes } from '@/lib/server/email-message';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftPageGroup } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { previewLookups } from '@/lib/server/lookups';
import { checkRoutes } from '@/lib/server/routing';
import { readsLookup, valueFields } from '@/lib/server/value-fields';
import type { RoutesPreviewView } from '@/lib/types';

export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  /** The routes as the editor has them, saved or not. */
  routes: destinationSpecSchema.shape.routes,
  sampleId: z.string().uuid().optional(),
  pageGroup: z.number().int().nonnegative().optional(),
});

/** A raw value as the routes compare it: text as it is, a number as JSON writes it. Null when it is not in the data. */
function rawText(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return '';
  return typeof value === 'string' ? value.trim() : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Where the documents of the preview spooled file go with the routes as the editor has
 * them: the route of each page group, and for the page group shown its values and each
 * route's conditions checked. Lookups run for every page group only when a condition
 * reads a field a lookup adds. Nothing is sent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, previewSchema);
  if ('response' in body) {
    return body.response;
  }
  const { routes } = body.data;
  const picked = await draftPageGroup(job, body.data, 'the routes');
  if ('response' in picked) {
    return picked.response;
  }
  const { draft, sample, def, index } = picked;
  let { groups } = picked;
  let lookupError = picked.lookups?.error?.message ?? null;
  const fields = routes.flatMap((route) => route.when.map((condition) => condition.field));
  if (groups.length > 1 && fields.some((field) => readsLookup(field, draft.lookups))) {
    const others = groups.map((_, at) => at).filter((at) => at !== index);
    const looked = await previewLookups(
      draft.source.serverId,
      draft.lookups,
      def,
      groups,
      [index, ...others],
      groups.map((group, at) => documentName(def, group, at)),
    );
    if (looked && !looked.preview.error) groups = looked.groups;
    else lookupError = looked?.preview.error?.message ?? lookupError;
  }
  const types = fieldTypes(def, draft.lookups);
  const pageGroupData = (at: number) => ({ pg: groups[at]!, splf: sample.splf });
  const shown = checkRoutes(routes, pageGroupData(index), types, false);
  const whole = draft.render.templates.some(perSpooledFile) ? checkRoutes(routes, spooledFileData(groups, sample), types, true) : null;
  const view: RoutesPreviewView = {
    pageGroup: index,
    pageGroups: groups.length,
    fields: valueFields(def, draft.lookups, false).map((path) => ({ path, value: rawText(valueAt(pageGroupData(index), path)) })),
    route: shown.route,
    checks: shown.checks,
    taken: groups.map((_, at) => (at === index ? shown.route : checkRoutes(routes, pageGroupData(at), types, false).route)),
    spooledFile: whole,
    lookupError: fields.some((field) => readsLookup(field, draft.lookups)) ? lookupError : null,
  };
  return json(view);
}
