import { describe, expect, it } from 'vitest';
import { groupOfPage } from '@/lib/client/render';

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
