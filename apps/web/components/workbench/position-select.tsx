'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { useWorkbench } from './workbench-provider';

/** Picks the page group shown on the page, in the JSON view and in the preview. */
export function PageGroupSelect() {
  const { render, pageGroupIndex, setPageGroupIndex } = useWorkbench();
  const pageGroups = render?.extract?.pageGroups ?? [];
  const names = render?.names ?? [];
  if (pageGroups.length === 0) {
    return null;
  }
  return (
    <Stepper
      name="page group"
      value={Math.min(pageGroupIndex, pageGroups.length - 1)}
      options={pageGroups.map((group, index) => ({
        value: index,
        label: `Page group ${index + 1} of ${pageGroups.length}${pageGroupTitle(names[index], group)}`,
      }))}
      onChange={setPageGroupIndex}
    />
  );
}

/** Picks the page of the spooled file shown in the page view. */
export function PageSelect() {
  const { render, page, setPage } = useWorkbench();
  const pages = render?.sample.pages ?? [];
  if (pages.length === 0) {
    return null;
  }
  return (
    <Stepper
      name="page"
      value={pages.some((p) => p.no === page) ? page : pages[0]!.no}
      options={pages.map((p) => ({ value: p.no, label: `Page ${p.no} of ${pages.length}` }))}
      onChange={(no) => setPage(no)}
    />
  );
}

/** Previous, a list to jump to any one, and next, as one control. */
function Stepper({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: number;
  options: { value: number; label: string }[];
  onChange(value: number): void;
}) {
  const index = options.findIndex((o) => o.value === value);
  const go = (delta: number) => {
    const next = options[index + delta];
    if (next) onChange(next.value);
  };
  return (
    <ButtonGroup className="min-w-0">
      <Button variant="outline" size="icon-sm" onClick={() => go(-1)} disabled={index <= 0} aria-label={`Previous ${name}`}>
        <ChevronLeftIcon />
      </Button>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={name[0]!.toUpperCase() + name.slice(1)}
        className="h-7 min-w-0 max-w-72 truncate border bg-background px-2 text-[0.8rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => go(1)}
        disabled={index < 0 || index >= options.length - 1}
        aria-label={`Next ${name}`}
      >
        <ChevronRightIcon />
      </Button>
    </ButtonGroup>
  );
}

/** The page group's document name, else its first short string value, as a hint after its number. */
function pageGroupTitle(name: string | undefined, group: Record<string, unknown>): string {
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
