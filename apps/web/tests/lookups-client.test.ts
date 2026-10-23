import { describe, expect, it } from 'vitest';
import { currentColumns, testedColumns } from '@/lib/client/lookups';

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
