import { describe, expect, it } from 'vitest';
import { groupOfPage, hitLabel } from '@/lib/client/render';

// Page 1 is skipped; page groups 2 and 3 share page 4, as XML page groups can.
const ranges = [
  { first: 2, last: 3 },
  { first: 3, last: 4 },
  { first: 4, last: 6 },
];

describe('groupOfPage', () => {
  it('keeps the current page group while it has the page', () => {
    expect(groupOfPage(ranges, 3, 0)).toBe(0);
    expect(groupOfPage(ranges, 3, 1)).toBe(1);
    expect(groupOfPage(ranges, 4, 2)).toBe(2);
  });

  it('picks the first page group with the page otherwise', () => {
    expect(groupOfPage(ranges, 4, 0)).toBe(1);
    expect(groupOfPage(ranges, 6, 0)).toBe(2);
  });

  it('is -1 for a page in no page group', () => {
    expect(groupOfPage(ranges, 1, 0)).toBe(-1);
    expect(groupOfPage([], 1, 0)).toBe(-1);
  });
});

describe('hitLabel', () => {
  const hit = { pageGroup: 0, name: 'invoiceNo', page: 1, line: 1, column: 1, length: 6, value: '260101', status: 'found' as const };

  it('names the field as the tag a template writes, with its page group', () => {
    expect(hitLabel(hit)).toBe('Page group 1: d.pg.invoiceNo = 260101');
    expect(hitLabel({ ...hit, pageGroup: 1, name: 'lines[2].quantity', value: '4' })).toBe('Page group 2: d.pg.lines[2].quantity = 4');
  });

  it('says when a value is missing or empty', () => {
    expect(hitLabel({ ...hit, value: '', status: 'missing' })).toBe('Page group 1: d.pg.invoiceNo = (missing)');
    expect(hitLabel({ ...hit, value: '', status: 'empty' })).toBe('Page group 1: d.pg.invoiceNo = (empty)');
  });
});
