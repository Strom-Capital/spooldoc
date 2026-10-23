import {
  bindParameters,
  boundValue,
  db2ValueType,
  extract,
  isLookupError,
  LOOKUP_NAME,
  LOOKUP_TIMEOUT_SECONDS,
  lookupProblems,
  lookupsSchema,
  MAX_LOOKUP_ROWS,
  parameterText,
  parameterValue,
  parseDefinition,
  typedLookupRows,
  type Definition,
  type Lookup,
} from '@spooldoc/core';
import { ConnectionError, type QueryColumn, type QueryParameter } from '@spooldoc/ibmi';
import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { isConnectionError, withConnection } from '@/lib/server/ibmi';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { previewCache, runLookups } from '@/lib/server/lookups';
import type { LookupTestParameter, LookupTestView } from '@/lib/types';

export const dynamic = 'force-dynamic';

const testSchema = z.object({
  /** The job's lookups as the editor has them, saved or not. */
  lookups: lookupsSchema,
  /** The lookup to test, by index. */
  index: z.number().int().nonnegative(),
  sampleId: z.string().uuid().optional(),
  pageGroup: z.number().int().nonnegative().optional(),
});

/** Rows a Test shows. */
const SHOWN_ROWS = 50;

/** A Db2 for i type with its length: `DECIMAL(7,0)`, `CHAR(10)`, `DATE`. */
function db2Type(column: Pick<QueryColumn, 'type' | 'precision' | 'scale'>): string {
  const type = column.type.toUpperCase();
  if (/^(DECIMAL|NUMERIC)$/.test(type)) return `${type}(${column.precision},${column.scale})`;
  if (/^(CHAR|VARCHAR|GRAPHIC|VARGRAPHIC|NCHAR|NVARCHAR|BINARY|VARBINARY)$/.test(type) && column.precision > 0) return `${type}(${column.precision})`;
  return type;
}

/** Why a value does not fit its marker, such as text bound to a DECIMAL marker; null when it does. */
function markerProblem(name: string, value: string | number | null, marker: QueryParameter | undefined): string | null {
  if (!marker || value === null || typeof value === 'number') return null;
  const type = db2ValueType(marker.type);
  if (type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value.trim())))) {
    return `:${name} is text ("${value}"), and Db2 for i compares it with a number (${db2Type(marker)}). Give the field type: number in the definition, or compare it with a text column.`;
  }
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return `:${name} is "${value}", and Db2 for i compares it with a date. Give the field type: date in the definition.`;
  }
  return null;
}

/** Problems with the result columns: a name templates cannot read, or one used twice. */
function columnProblems(name: string, columns: readonly QueryColumn[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, column] of columns.entries()) {
    if (!LOOKUP_NAME.test(column.name)) {
      problems.push(`Column ${index + 1} of ${name} is named ${column.name}, which templates cannot read. Name it with AS, such as TRIM(NAME) AS NAME.`);
    } else if (seen.has(column.name)) {
      problems.push(`${name} returns two columns named ${column.name}. Give one of them another name with AS.`);
    }
    seen.add(column.name);
  }
  return problems;
}

/**
 * Test one lookup with the values of a page group of the preview spooled file:
 *
 * 1. `lookupProblems`, without the IBM i;
 * 2. `describeQuery`: one SELECT that Db2 for i accepts, its columns and its parameter markers;
 * 3. the earlier lookups, from the preview's cache, for the values it may read;
 * 4. the lookup itself, not from the cache, with the page group's values (for a row
 *    lookup, its table's first row).
 *
 * It answers with the columns to keep as the lookup's `checked`, the bound parameters
 * and where they came from, up to 50 rows, the row count and the time. A problem is 422;
 * an IBM i error is mapped by `connectionErrorResponse`. Nothing changes on the IBM i:
 * the query runs on a read-only connection.
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
  const body = await readJson(request, testSchema);
  if ('response' in body) {
    return body.response;
  }
  const { lookups, index } = body.data;
  const lookup: Lookup | undefined = lookups[index];
  if (!lookup) {
    return errorResponse(400, `There is no lookup ${index + 1}.`);
  }
  const name = lookup.name.trim() || `Lookup ${index + 1}`;
  const { draft, sample } = await draftAndSample(job, body.data.sampleId);
  if (!sample) {
    return errorResponse(404, 'Pick a spooled file to preview first, so the lookup has values to run with.');
  }
  let def: Definition;
  try {
    def = parseDefinition(draft.extract.definition);
  } catch {
    return errorResponse(422, 'The definition has errors. Fix it in the Extract step, then test the lookup.');
  }
  let groups: Record<string, unknown>[];
  try {
    groups = extract(def, sample).pageGroups;
  } catch (error) {
    return errorResponse(422, `The extraction failed, so the lookup has no values to run with: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (groups.length === 0) {
    return errorResponse(422, 'The definition finds no page groups in this spooled file, so the lookup has no values to run with.');
  }
  const pageGroup = Math.min(body.data.pageGroup ?? 0, groups.length - 1);
  const problems = lookupProblems(def, lookups)
    .filter((p) => p.index === index)
    .map((p) => p.message);
  if (problems.length > 0) {
    return json({ error: problems[0], problems }, { status: 422 });
  }
  const serverId = draft.source.serverId;
  if (!serverId) {
    return errorResponse(409, 'Pick a server in the Source step first. Lookups run on its IBM i.');
  }

  return withConnection(serverId, async (conn, server) => {
    const started = performance.now();
    const { sql, names } = bindParameters(lookup.sql);
    const could = (error: unknown): never => {
      if (isConnectionError(error)) {
        throw new ConnectionError(error.code, `Could not run ${name}: ${error.message}`, {
          ...(error.messageId ? { messageId: error.messageId } : {}),
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }
      throw error;
    };
    const description = await conn.describeQuery(sql).catch(could);
    const badColumns = columnProblems(name, description.columns);
    if (badColumns.length > 0) {
      return json({ error: badColumns[0], problems: badColumns }, { status: 422 });
    }

    // The earlier lookups give the values this one may read, as a run would have them.
    let group = groups[pageGroup]!;
    if (index > 0) {
      const earlier = await runLookups(conn, lookups.slice(0, index), groups, { cache: previewCache(server.id), only: [pageGroup] }).catch((error: unknown) => {
        if (!isLookupError(error)) throw error;
        // An earlier lookup stopped: its own message names it.
        throw new ConnectionError(isConnectionError(error.cause) ? error.cause.code : 'query', error.message, error.detail ? { detail: error.detail } : {});
      });
      group = earlier.groups[pageGroup]!;
    }

    let scopes: Record<string, unknown>[] = [group];
    let row: number | undefined;
    let prefix = 'd.pg';
    if (lookup.for !== undefined) {
      const table = group[lookup.for];
      const first = Array.isArray(table) ? (table[0] as Record<string, unknown> | undefined) : undefined;
      if (!first) {
        return errorResponse(422, `${lookup.for} has no rows in page group ${pageGroup + 1}. Pick a page group that has some to test ${name}.`);
      }
      scopes = [first, group];
      row = 0;
      prefix = `d.pg.${lookup.for}[0]`;
    }

    const parameters: LookupTestParameter[] = [];
    const markerProblems: string[] = [];
    for (const [i, parameter] of names.entries()) {
      const found = parameterValue(parameter, scopes);
      const value = found.found ? boundValue(found.value) : undefined;
      if (value === undefined) {
        return errorResponse(422, `:${parameter} has no single value in page group ${pageGroup + 1}. Check the name against the definition.`);
      }
      const marker = description.parameters[i];
      const inRow = lookup.for !== undefined && parameter.split('.')[0]! in scopes[0]!;
      parameters.push({ name: parameter, value, source: `${inRow ? prefix : 'd.pg'}.${parameter}`, marker: marker ? db2Type(marker) : null });
      const problem = markerProblem(parameter, value, marker);
      if (problem && !markerProblems.includes(problem)) markerProblems.push(problem);
    }
    if (markerProblems.length > 0) {
      return json({ error: markerProblems[0], problems: markerProblems }, { status: 422 });
    }

    const values = parameters.map((p) => p.value);
    const result = await conn
      .query(sql, values, { maxRows: lookup.result === 'one' ? SHOWN_ROWS : MAX_LOOKUP_ROWS, timeoutSeconds: LOOKUP_TIMEOUT_SECONDS })
      .catch(could);
    const forValues = parameters.length > 0 ? ` for ${parameterText(parameters)}` : '';
    if (lookup.result === 'one' && result.rows.length > 1) {
      const count = result.truncated ? `more than ${SHOWN_ROWS} rows` : `${result.rows.length} rows`;
      return errorResponse(422, `${name} returned ${count}${forValues}. Add a condition, or FETCH FIRST 1 ROW ONLY.`);
    }
    if (result.truncated) {
      const most = MAX_LOOKUP_ROWS.toLocaleString('en-US');
      return errorResponse(422, `${name} returned more than ${most} rows${forValues}. A lookup reads at most ${most} rows. Add a condition.`);
    }
    const columns = description.columns.map((c) => ({ name: c.name, type: db2ValueType(c.type), db2: db2Type(c) }));
    const view: LookupTestView = {
      checked: { sql: lookup.sql, columns: columns.map((c) => ({ name: c.name, type: c.type })) },
      columns,
      parameters,
      rows: typedLookupRows(result).slice(0, SHOWN_ROWS),
      rowCount: result.rows.length,
      ms: Math.round(performance.now() - started),
      host: server.host,
      ...(row !== undefined ? { row } : {}),
    };
    return json(view);
  });
}
