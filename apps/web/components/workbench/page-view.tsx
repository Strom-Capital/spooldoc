'use client';

import { useEffect, useMemo, useRef } from 'react';
import { SpoolViewer } from '@/components/spool-viewer';
import { hitKey, hitLabel } from '@/lib/client/render';
import { useWorkbench } from './workbench-provider';

/**
 * One page of the sample as a monospace grid, with a highlight for every field hit on
 * it: found (accent), empty (yellow) and missing (red outline where the anchor is known).
 * The page, the page group and the spooled file are picked in the bar above.
 */
export function PageView() {
  const { render, page, setPage, selectedHit, setSelectedHit, setTab, pageGroupIndex, setPageGroupIndex } = useWorkbench();
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => render?.sample.pages ?? [], [render]);
  const current = pages.find((p) => p.no === page) ?? pages[0];
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
      setPage(selectedHit.page, selectedHit.pageGroup);
    }
  }, [selectedHit, page, pages, setPage]);
  useEffect(() => {
    if (!selectedKey) return;
    const el = scroller.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [selectedKey, page]);

  return (
    <SpoolViewer
      pages={pages}
      width={render?.sample.attributes.pageWidth ?? 132}
      page={page}
      onPage={setPage}
      paging={false}
      scrollerRef={scroller}
      empty={render ? 'This sample has no pages.' : 'Loading...'}
      overlay={() =>
        hits.map((hit) => {
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
                if (hit.pageGroup !== pageGroupIndex) setPageGroupIndex(hit.pageGroup);
              }}
            />
          );
        })
      }
    />
  );
}

