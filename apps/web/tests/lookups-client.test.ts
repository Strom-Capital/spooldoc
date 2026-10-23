import { describe, expect, it } from 'vitest';
import type { Lookup, LookupTrace } from '@spooldoc/core';
import { currentColumns, lookupSummary, lookupsSub, previewFor, summaryText, testedColumns } from '@/lib/client/lookups';
import type { LookupsPreview } from '@/lib/client/render';

const sql = 'SELECT NAME FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNo';
const checked = { sql, columns: [{ name: 'NAME', type: 'string' as const }] };

describe('lookup columns in the Lookups step', () => {
  it("shows the last Test's columns only while the SQL is the one tested", () => {
    expect(testedColumns({ sql, checked })).toEqual(checked.columns);
    expect(testedColumns({ sql: `${sql} AND 1 = 1`, checked })).toEqual([]);
    expect(testedColumns({ sql })).toEqual([]);
  });

  it("prefers a Test of this SQL in the session, and drops one of other SQL or one that failed", () => {
    const view = { columns: [{ name: 'EMAIL', type: 'string' as const, db2: 'VARCHAR(80)' }] };
    expect(currentColumns({ sql, checked }, { sql, view })).toEqual(view.columns);
    const changed = `${sql} AND 1 = 1`;
    expect(currentColumns({ sql: changed, checked }, { sql, view })).toEqual([]);
    expect(currentColumns({ sql: changed, checked }, { sql: changed })).toEqual([]);
    expect(currentColumns({ sql, checked }, { sql: 'SELECT 1 FROM MYLIB.T' })).toEqual(checked.columns);
  });
});

const preview = (over: Partial<LookupsPreview> = {}): LookupsPreview => ({ traces: [], misses: [], problems: [], ran: ['customer', 'product'], ...over });
const trace = (lookup: string, rows: number, over: Partial<LookupTrace> = {}): LookupTrace => ({ lookup, pageGroup: 4, parameters: [], rows, ms: 1, cached: false, ...over });
const customer: Lookup = { name: 'customer', sql, result: 'one', missing: 'warn', checked };
const productSql = 'SELECT DESCRIPTION FROM MYLIB.ITEMS WHERE ITEMNO = :item AND LANG = :customer.LANG';
const product: Lookup = { name: 'product', for: 'lines', sql: productSql, result: 'one', missing: 'warn', checked: { sql: productSql, columns: [{ name: 'DESCRIPTION', type: 'string' }] } };

describe('the lookups of the page group shown', () => {
  it('takes no lookups from a render of another page group', () => {
    const lookups = preview({ misses: [{ lookup: 'customer', pageGroup: 4, text: 'No row in customer for customerNo 10007' }] });
    expect(previewFor({ pageGroup: 4, lookups }, 4)).toBe(lookups);
    expect(previewFor({ pageGroup: 0, lookups }, 4)).toBeUndefined();
    expect(previewFor(null, 0)).toBeUndefined();
  });

  it('puts the first miss in the pipeline, and counts the rows of the one lookup only', () => {
    const miss = 'No row in customer for customerNo 10007 (pick-list-700005). product is left empty';
    expect(lookupsSub([customer, product], preview({ misses: [{ lookup: 'customer', pageGroup: 4, text: miss }] }))).toBe(miss);
    expect(lookupsSub([customer, product], preview({ traces: [trace('customer', 1), trace('product', 1, { row: 0 }), trace('product', 1, { row: 1 })] }))).toBe(
      'Every lookup found its rows in this page group',
    );
    expect(lookupsSub([customer], preview({ traces: [trace('customer', 1)] }))).toBe('1 row in this page group');
    expect(lookupsSub([customer], undefined)).toBeUndefined();
  });

  it('says what a lookup did in the page group, also when an earlier one left it empty', () => {
    const found = preview({ traces: [trace('customer', 1, { parameters: [{ name: 'customerNo', value: '10001' }] }), trace('product', 1, { row: 0 }), trace('product', 0, { row: 1 })] });
    expect(lookupSummary(customer, found)).toMatchObject({ ran: 1, rows: 1, parameters: [{ name: 'customerNo', value: '10001' }] });
    expect(summaryText(customer, lookupSummary(customer, found))).toBe('In this page group, customer found 1 row.');
    expect(summaryText(product, lookupSummary(product, found))).toBe('In this page group, product ran for 2 rows of lines: 1 found a row and 1 found none.');
    const missed = preview({ traces: [trace('customer', 0), ...[0, 1, 2].map((row) => trace('product', 0, { row, skippedFor: 'customer' }))] });
    expect(summaryText(customer, lookupSummary(customer, missed))).toBe('In this page group, customer found no row.');
    expect(summaryText(product, lookupSummary(product, missed))).toBe('customer found no row, so product did not run for 3 rows of lines and is left empty.');
    expect(summaryText(product, lookupSummary(product, preview()))).toBeUndefined();
  });
});
