'use client';

import { useWorkbench } from './workbench-provider';

/** Picks the page group shown in the JSON view and the preview (shared). */
export function PageGroupSelect() {
  const { render, pageGroupIndex, setPageGroupIndex } = useWorkbench();
  const pageGroups = render?.extract?.pageGroups ?? [];
  const names = render?.names ?? [];
  if (pageGroups.length === 0) {
    return null;
  }
  return (
    <select
      value={Math.min(pageGroupIndex, pageGroups.length - 1)}
      onChange={(event) => setPageGroupIndex(Number(event.target.value))}
      aria-label="Page group"
      className="h-7 min-w-0 max-w-56 rounded-md border bg-background px-1.5 text-sm"
    >
      {pageGroups.map((group, index) => (
        <option key={index} value={index}>
          Page group {index + 1} of {pageGroups.length}
          {groupTitle(names[index], group)}
        </option>
      ))}
    </select>
  );
}

/** The page group's document name, else its first short string value, as a hint in the selector. */
function groupTitle(name: string | undefined, group: Record<string, unknown>): string {
  if (name) {
    return `: ${name.slice(0, 24)}`;
  }
  for (const value of Object.values(group)) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return `: ${String(value).trim().slice(0, 24)}`;
    }
  }
  return '';
}
