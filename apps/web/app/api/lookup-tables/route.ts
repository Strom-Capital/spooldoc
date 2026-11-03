import { LOOKUP_TABLE_NAME, lookupTableContentSchema } from '@spooldoc/core';
import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { lookupTableJobs } from '@/lib/server/jobs-using';
import { contentError, createLookupTable, listLookupTables, TABLE_NAME_RULE } from '@/lib/server/lookup-tables';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().regex(LOOKUP_TABLE_NAME, TABLE_NAME_RULE),
  /** Checked with the rows by `lookupTableContentSchema`. */
  columns: z.array(z.unknown()),
  rows: z.array(z.unknown()),
});

/** Every lookup table without its rows, by name, with the jobs that read it. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json({ tables: await listLookupTables(await lookupTableJobs()) });
}

/** Create a lookup table: its name, columns and rows. 409 when the name is taken. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, createSchema);
  if ('response' in body) {
    return body.response;
  }
  const content = lookupTableContentSchema.safeParse({ columns: body.data.columns, rows: body.data.rows });
  if (!content.success) {
    return contentError(content.error);
  }
  const table = await createLookupTable({ name: body.data.name, ...content.data });
  if (!table) {
    return errorResponse(409, `There is already a lookup table named ${body.data.name}. Pick another name.`);
  }
  return json({ ...table, jobs: [], keyJobs: {} }, { status: 201 });
}
