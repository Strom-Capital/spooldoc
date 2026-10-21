'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** How long a heading stays pinned while the page settles, at most. */
const SETTLE_MS = 5000;
/** Anything the reader does to move the page ends the pin. */
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

let unpin: (() => void) | undefined;

/**
 * Keeps the heading with this id at the top of the window while the page above it
 * settles. A Mermaid diagram draws itself after the page has scrolled, at a height known
 * only then, and would push the heading out of view. The pin ends when the reader moves
 * the page, or after a few seconds.
 *
 * @param id - The heading's id, without `#`. An empty or unknown id only ends the last pin.
 */
export function pinHeading(id: string) {
  unpin?.();
  const target = id ? document.getElementById(id) : null;
  if (!target) {
    return;
  }
  const place = () => target.scrollIntoView({ block: 'start' });
  const observer = new ResizeObserver(place);
  const end = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of READER_INPUT) {
      window.removeEventListener(type, end, true);
    }
    unpin = undefined;
  };
  const timer = setTimeout(end, SETTLE_MS);
  for (const type of READER_INPUT) {
    window.addEventListener(type, end, { capture: true, passive: true });
  }
  unpin = end;
  place();
  observer.observe(document.body);
}

/** Pins the heading in the address bar's `#` after each page change and each `#` link. */
export function useHeadingPin() {
  const pathname = usePathname();
  useEffect(() => pinHeading(currentHash()), [pathname]);
  useEffect(() => {
    const onHashChange = () => pinHeading(currentHash());
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unpin?.();
    };
  }, []);
}

function currentHash(): string {
  const hash = window.location.hash.slice(1);
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}
