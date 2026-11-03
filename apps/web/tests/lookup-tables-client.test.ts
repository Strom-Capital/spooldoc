import { describe, expect, it } from 'vitest';
import { badCells, badCellsText, cellText, filterRows, jobNames, newColumnName, parseCell, toCells } from '@/lib/client/lookup-tables';

const columns = [
  { name: 'CODE', type: 'string' as const },
  { name: 'RATE', type: 'number' as const },
  { name: 'FROM', type: 'date' as const },
];

describe('cells in the table page', () => {
  it('reads a cell as its column type has it, with a decimal point or comma', () => {
    expect(parseCell(' 1,5 ', 'number')).toEqual({ cell: 1.5, ok: true });
    expect(parseCell('-2.25', 'number')).toEqual({ cell: -2.25, ok: true });
    expect(parseCell('1 234', 'number')).toEqual({ cell: 1234, ok: true });
    expect(parseCell('twelve', 'number').ok).toBe(false);
    expect(parseCell('15.10.2026', 'date')).toEqual({ cell: '2026-10-15', ok: true });
    expect(parseCell('2026-02-30', 'date').ok).toBe(false);
    expect(parseCell('  ', 'date')).toEqual({ cell: null, ok: true });
    expect(parseCell(' as typed ', 'string')).toEqual({ cell: ' as typed ', ok: true });
    expect(cellText(null)).toBe('');
    expect(cellText(1.5)).toBe('1.5');
  });

  it('finds the cells that do not fit their column and says where the first one is', () => {
    const rows = [
      ['A', '1', '2026-01-01'],
      ['B', 'x', 'soon'],
    ];
    const bad = badCells(columns, rows);
    expect(bad).toEqual([
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]);
    expect(badCellsText(columns, bad)).toBe('2 cells do not fit their column. The first is row 2, column RATE, which takes a number.');
    expect(badCellsText(columns, [{ row: 0, column: 2 }])).toBe('A cell does not fit its column. It is row 1, column FROM, which takes a date, YYYY-MM-DD.');
    expect(badCellsText(columns, [])).toBeNull();
    expect(toCells(columns, [rows[0]!])).toEqual([['A', 1, '2026-01-01']]);
  });

  it('filters rows by any cell, ignoring case', () => {
    const rows = [
      ['NET14', 'Net 14 days'],
      ['NET30', 'Net 30 days'],
    ];
    expect(filterRows(rows, '30')).toEqual([1]);
    expect(filterRows(rows, 'net')).toEqual([0, 1]);
    expect(filterRows(rows, ' ')).toEqual([0, 1]);
  });

  it('names a new column and the jobs a change breaks', () => {
    expect(newColumnName([{ name: 'COLUMN_2' }, { name: 'X' }])).toBe('COLUMN_3');
    expect(jobNames([{ name: 'Invoices' }])).toBe('Invoices');
    expect(jobNames([{ name: 'Invoices' }, { name: 'Statements' }, { name: 'Pick lists' }])).toBe('Invoices, Statements and Pick lists');
  });
});
