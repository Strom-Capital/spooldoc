'use client';

import type { SamplePage } from '@spooldoc/core';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { pageLines } from '@/lib/client/render';

/** Smallest and largest font size when fitting the page width, in pixels. */
const FIT_MIN = 7;
const FIT_MAX = 12;
/** Horizontal padding and borders around the grid: the scroller's and the paper's. */
const FRAME_PX = 12 * 2 + 12 * 2 + 2;

/**
 * Pages of a spooled file as a monospace grid, one page at a time, with page paging and
 * fit-to-width. By default the text shrinks so the whole page width fits the pane.
 * `overlay` is drawn over the current page's grid (positioned in `ch` and `em`). Without
 * `paging` the page is picked elsewhere. The zoom sits in the bottom corner, over the page.
 */
export function SpoolViewer({
  pages,
  width,
  page,
  onPage,
  overlay,
  paging = true,
  scrollerRef,
  empty = 'This spooled file has no pages.',
}: {
  pages: SamplePage[];
  width: number;
  page: number;
  onPage(page: number): void;
  overlay?: (current: SamplePage) => ReactNode;
  paging?: boolean;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  empty?: string;
}) {
  const ownScroller = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? ownScroller;
  const grid = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const [fontSize, setFontSize] = useState<number | null>(null);
  const current = pages.find((p) => p.no === page) ?? pages[0];
  const lines = useMemo(() => (current ? pageLines(current, width) : []), [current, width]);

  // Scale the font so `width` columns fit the pane, between FIT_MIN and the 12px of .spool-page.
  useEffect(() => {
    const box = scroller.current;
    if (!fit || !box) return;
    const measure = () => {
      const el = grid.current;
      if (!el || box.clientWidth === 0) return;
      const size = parseFloat(getComputedStyle(el).fontSize);
      const columnPx = el.offsetWidth / width / size;
      const available = box.clientWidth - FRAME_PX;
      setFontSize(Math.min(Math.max(available / (width * columnPx), FIT_MIN), FIT_MAX));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit, width, current, scroller]);

  const index = current ? pages.indexOf(current) : -1;
  const go = (delta: number) => {
    const next = pages[index + delta];
    if (next) onPage(next.no);
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Page view">
      {paging && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-sm">
          <span className="mr-1 font-medium">Page</span>
          <Hint text={index <= 0 ? undefined : 'Previous page'}>
            <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous page">
              <ChevronLeftIcon />
            </Button>
          </Hint>
          <select
            value={current?.no ?? ''}
            onChange={(event) => onPage(Number(event.target.value))}
            aria-label="Page"
            className="h-7 rounded-md border bg-background px-1.5 text-sm"
          >
            {pages.map((p) => (
              <option key={p.no} value={p.no}>
                {p.no} of {pages.length}
              </option>
            ))}
          </select>
          <Hint text={index < 0 || index >= pages.length - 1 ? undefined : 'Next page'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => go(1)}
              disabled={index < 0 || index >= pages.length - 1}
              aria-label="Next page"
            >
              <ChevronRightIcon />
            </Button>
          </Hint>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-auto bg-muted/30 p-3 pb-14">
          {current ? (
            <div className="spool-page inline-block rounded border p-3 shadow-sm" style={fit && fontSize ? { fontSize } : undefined}>
              <div ref={grid} className="relative" style={{ width: `${width}ch` }}>
                {lines.join('\n') || ' '}
                {overlay?.(current)}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{empty}</p>
          )}
        </div>
        {current && <Zoom fit={fit} onFit={setFit} />}
      </div>
    </section>
  );
}

/** Fit the page width to the pane, or show the page at its actual size. */
function Zoom({ fit, onFit }: { fit: boolean; onFit(fit: boolean): void }) {
  return (
    <ButtonGroup aria-label="Zoom" className="absolute right-3 bottom-3 rounded-lg bg-background shadow-md">
      <Button variant={fit ? 'secondary' : 'outline'} size="sm" aria-pressed={fit} onClick={() => onFit(true)}>
        Fit width
      </Button>
      <Button variant={fit ? 'outline' : 'secondary'} size="sm" aria-pressed={!fit} onClick={() => onFit(false)}>
        100%
      </Button>
    </ButtonGroup>
  );
}
