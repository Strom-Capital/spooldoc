/** What a click on a table row's own controls lands on; such a click is the control's, not the row's. */
export const ROW_CONTROLS =
  'a, button, input, select, textarea, label, summary, [contenteditable="true"], [role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="option"], [role="switch"]';

/** The parts of a click the decision reads. */
export interface RowClick {
  /** The element clicked. */
  target: Element | null;
  /** The row. React passes events from portals, such as an open menu, up through it too. */
  row: Node;
  /** The text selected on the page. */
  selection: string;
}

/**
 * Whether a click opens the row: not on one of its controls, not from outside the
 * row's own elements, and not when it ends a text selection, so people can copy from it.
 */
export function opensRow({ target, row, selection }: RowClick): boolean {
  if (!target || !row.contains(target)) return false;
  if (target.closest(ROW_CONTROLS)) return false;
  return selection === '';
}

/** Whether a click asks for a new tab, as it would on a link: cmd or ctrl, shift, or the middle button. */
export function wantsNewTab(click: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }): boolean {
  return click.metaKey || click.ctrlKey || click.shiftKey || click.button === 1;
}
