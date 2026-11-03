import { toCsv } from '@spooldoc/core';
import { guard } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/http';
import { getLookupTable } from '@/lib/server/lookup-tables';
import { UUID } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

/** A lookup table as a CSV file: UTF-8 with a BOM, comma delimited, numbers with a decimal point. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const id = (await params).id;
  const table = UUID.test(id) ? await getLookupTable(id) : undefined;
  if (!table) {
    return errorResponse(404, 'Lookup table not found.');
  }
  // The name is ASCII by its rule, so it goes in the header as it is.
  return new Response(toCsv(table.columns, table.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table.name}.csv"`,
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
