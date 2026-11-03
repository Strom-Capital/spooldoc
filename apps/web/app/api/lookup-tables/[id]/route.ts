import { LOOKUP_TABLE_NAME, lookupTableContentSchema } from '@spooldoc/core';
import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { jobsUsingLookupTable, lookupTableKeyJobs } from '@/lib/server/jobs-using';
import { contentError, deleteLookupTable, getLookupTable, TABLE_NAME_RULE, updateLookupTable, type LookupTableRecord } from '@/lib/server/lookup-tables';
import type { LookupTableView } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tableId = async (params: Context['params']): Promise<string | null> => {
  const id = (await params).id;
  return UUID.test(id) ? id : null;
};

const updateSchema = z.object({
  /** The revision the change was made on. A save over a newer one is refused. */
  revision: z.number().int().positive(),
  name: z.string().trim().regex(LOOKUP_TABLE_NAME, TABLE_NAME_RULE).optional(),
  /** Checked with the rows by `lookupTableContentSchema`. */
  columns: z.array(z.unknown()).optional(),
  rows: z.array(z.unknown()).optional(),
});

/** The table as its page shows it: with its rows, the jobs that read it, and the jobs keyed on each column. */
async function withJobs(table: LookupTableRecord): Promise<LookupTableView> {
  const [jobs, keyJobs] = await Promise.all([jobsUsingLookupTable(table.id), lookupTableKeyJobs(table.id)]);
  return { ...table, jobs, keyJobs };
}

/** One lookup table with its rows. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const id = await tableId(params);
  const table = id ? await getLookupTable(id) : undefined;
  if (!table) {
    return errorResponse(404, 'Lookup table not found.');
  }
  return json(await withJobs(table));
}

/**
 * Rename a lookup table, or save its columns and rows. The body names the revision the
 * change was made on: 409 when someone saved since, or when the new name is taken.
 */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const id = await tableId(params);
  const current = id ? await getLookupTable(id) : undefined;
  if (!current) {
    return errorResponse(404, 'Lookup table not found.');
  }
  const body = await readJson(request, updateSchema);
  if ('response' in body) {
    return body.response;
  }
  const { revision, name } = body.data;
  const changes: Parameters<typeof updateLookupTable>[1] = {};
  if (name !== undefined) changes.name = name;
  if (body.data.columns !== undefined || body.data.rows !== undefined) {
    const content = lookupTableContentSchema.safeParse({ columns: body.data.columns ?? current.columns, rows: body.data.rows ?? current.rows });
    if (!content.success) {
      return contentError(content.error);
    }
    changes.columns = content.data.columns;
    changes.rows = content.data.rows;
  }
  const result = await updateLookupTable(current.id, changes, revision);
  if (result === 'not-found') {
    return errorResponse(404, 'Lookup table not found.');
  }
  if (result === 'changed') {
    return errorResponse(409, `Could not save: ${current.name} changed since you opened it. Reload to see the changes.`);
  }
  if (result === 'name-taken') {
    return errorResponse(409, `There is already a lookup table named ${name}. Pick another name.`);
  }
  return json(await withJobs(result));
}

/**
 * Delete a lookup table. The page asks first and names the jobs that read it; their runs
 * fail at the Lookups step until another table is picked.
 */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const id = await tableId(params);
  if (!id || !(await deleteLookupTable(id))) {
    return errorResponse(404, 'Lookup table not found.');
  }
  return new Response(null, { status: 204 });
}
