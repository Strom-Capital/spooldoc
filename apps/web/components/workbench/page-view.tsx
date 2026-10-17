'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { hitKey, hitLabel, pageLines } from '@/lib/client/render';
import { useWorkbench } from './workbench-provider';

/**
 * One page of the sample as a monospace grid, with a highlight for every field hit on
 * it: found (accent), empty (yellow) and missing (red outline where the anchor is known).
 */
export function PageView() {
  const { render, page, setPage, selectedHit, setSelectedHit, setTab, documentIndex, setDocumentIndex } = useWorkbench();
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => render?.sample.pages ?? [], [render]);
  const width = render?.sample.attributes.pageWidth ?? 132;
  const current = pages.find((p) => p.no === page) ?? pages[0];
  const lines = useMemo(() => (current ? pageLines(current, width) : []), [current, width]);
  const hits = useMemo(
    () =>
      (render?.extract?.hits ?? []).filter(
        (hit) => current && hit.page === current.no && hit.line > 0 && hit.column > 0,
      ),
    [render, current],
  );
  const selectedKey = selectedHit ? hitKey(selectedHit) : null;

  // Show the page of a hit selected elsewhere, then scroll it into view.
  useEffect(() => {
    if (selectedHit && selectedHit.page !== page && pages.some((p) => p.no === selectedHit.page)) {
      setPage(selectedHit.page);
    }
  }, [selectedHit, page, pages, setPage]);
  useEffect(() => {
    if (!selectedKey) return;
    const el = scroller.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [selectedKey, page]);

  const index = current ? pages.indexOf(current) : -1;
  const go = (delta: number) => {
    const next = pages[index + delta];
    if (next) setPage(next.no);
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Page view">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-sm">
        <span className="mr-1 font-medium">Page</span>
        <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous page">
          <ChevronLeftIcon />
        </Button>
        <select
          value={current?.no ?? ''}
          onChange={(event) => setPage(Number(event.target.value))}
          aria-label="Page"
          className="h-7 rounded-md border bg-background px-1.5 text-sm"
        >
          {pages.map((p) => (
            <option key={p.no} value={p.no}>
              {p.no} of {pages.length}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => go(1)}
          disabled={index < 0 || index >= pages.length - 1}
          aria-label="Next page"
        >
          <ChevronRightIcon />
        </Button>
        <span className="ml-auto text-muted-foreground text-xs">
          {hits.length} {hits.length === 1 ? 'field' : 'fields'} on this page
        </span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
        {current ? (
          <div className="spool-page inline-block rounded border p-3 shadow-sm">
            <div className="relative" style={{ width: `${width}ch` }}>
              {lines.join('\n') || ' '}
              {hits.map((hit) => {
                const key = hitKey(hit);
                return (
                  <span
                    key={key}
                    data-key={key}
                    data-status={hit.status}
                    data-selected={key === selectedKey}
                    className="hit"
                    title={hitLabel(hit)}
                    role="button"
                    tabIndex={-1}
                    aria-label={hitLabel(hit)}
                    style={{
                      top: `${(hit.line - 1) * 1.5}em`,
                      left: `${hit.column - 1}ch`,
                      width: `${Math.max(1, hit.length)}ch`,
                      height: '1.5em',
                    }}
                    onClick={() => {
                      setSelectedHit(hit);
                      setTab('json');
                      if (hit.document !== documentIndex) setDocumentIndex(hit.document);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{render ? 'This sample has no pages.' : 'Loading...'}</p>
        )}
      </div>
    </section>
  );
}
