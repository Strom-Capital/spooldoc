import { describe, expect, it } from 'vitest';
import { opensRow, ROW_CONTROLS, wantsNewTab } from '@/lib/client/row-click';

/** A stand-in element: `control` says whether it sits inside one of the row's controls. */
function element(control: boolean): Element {
  return { closest: (selector: string) => (control && selector === ROW_CONTROLS ? {} : null) } as unknown as Element;
}

const cell = element(false);
const button = element(true);
const row = { contains: (node: unknown) => node === cell || node === button } as unknown as Node;

describe('row click', () => {
  it('opens on a click on the row itself', () => {
    expect(opensRow({ target: cell, row, selection: '' })).toBe(true);
  });

  it('leaves a click on a control to the control', () => {
    expect(opensRow({ target: button, row, selection: '' })).toBe(false);
  });

  it('ignores a click from outside the row, such as a menu item in a portal', () => {
    expect(opensRow({ target: element(false), row, selection: '' })).toBe(false);
    expect(opensRow({ target: null, row, selection: '' })).toBe(false);
  });

  it('does not open when the click ends a text selection', () => {
    expect(opensRow({ target: cell, row, selection: '012345' })).toBe(false);
  });

  it('opens a new tab as a link would', () => {
    const plain = { metaKey: false, ctrlKey: false, shiftKey: false, button: 0 };
    expect(wantsNewTab(plain)).toBe(false);
    expect(wantsNewTab({ ...plain, metaKey: true })).toBe(true);
    expect(wantsNewTab({ ...plain, ctrlKey: true })).toBe(true);
    expect(wantsNewTab({ ...plain, button: 1 })).toBe(true);
  });
});

describe('row controls', () => {
  it('covers links, buttons, form fields and menu items', () => {
    for (const selector of ['a', 'button', 'input', 'label', '[role="checkbox"]', '[role="menuitem"]']) {
      expect(ROW_CONTROLS.split(', ')).toContain(selector);
    }
  });
});
