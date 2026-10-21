'use client';

import MiniSearch, { type SearchResult } from 'minisearch';
import { SearchIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { shortcut } from '@/lib/client/keys';
import type { DocsSection } from '@/lib/server/docs';

type Index = MiniSearch<DocsSection & { id: number }>;
type Loaded = { state: 'idle' | 'loading' } | { state: 'ready'; index: Index } | { state: 'error'; message: string };

const OpenSearch = createContext<() => void>(() => undefined);

/**
 * Search over every section of every guide, opened with ⌘K or Ctrl+K or a
 * `DocsSearchButton`. The index (/docs/search.json) loads the first time it opens.
 */
export function DocsSearch({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded>({ state: 'idle' });

  const load = useCallback(async () => {
    setLoaded({ state: 'loading' });
    try {
      const response = await fetch('/docs/search.json');
      if (!response.ok) {
        throw new Error(`The server answered ${response.status}.`);
      }
      const sections = (await response.json()) as DocsSection[];
      const index: Index = new MiniSearch({
        fields: ['pageTitle', 'heading', 'text'],
        storeFields: ['page', 'pageTitle', 'heading', 'anchor', 'text'],
        searchOptions: { prefix: true, fuzzy: 0.2, boost: { heading: 3, pageTitle: 2 }, combineWith: 'AND' },
      });
      index.addAll(sections.map((section, id) => ({ ...section, id })));
      setLoaded({ state: 'ready', index });
    } catch (error) {
      setLoaded({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    if (loaded.state === 'idle') {
      void load();
    }
  }, [load, loaded.state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          show();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, show]);

  const groups = useMemo(() => (loaded.state === 'ready' && query.trim() ? groupByPage(loaded.index.search(query)) : []), [loaded, query]);

  // Where to go once the dialog has closed. Going while its scroll lock still hides the
  // scrollbar would scroll to a layout that rewraps when the scrollbar comes back.
  const target = useRef<string | null>(null);

  function go(page: string, anchor: string) {
    target.current = `/docs/${page}${anchor ? `#${anchor}` : ''}`;
    setOpen(false);
  }

  function onClosed(event: Event) {
    const href = target.current;
    target.current = null;
    if (href) {
      // Focus stays with the page we go to, not the button that opened the search.
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <OpenSearch.Provider value={show}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} title="Search the docs" description="Find a guide or a section by its words."
        onCloseAutoFocus={onClosed}
      >
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search the docs" />
          <CommandList className="max-h-[min(28rem,60svh)]">
            {loaded.state === 'error' ? (
              <div className="p-2">
                <ErrorNote
                  action={
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
                      Try again
                    </Button>
                  }
                >
                  Could not load the search index. {loaded.message} Check the connection and try again.
                </ErrorNote>
              </div>
            ) : loaded.state !== 'ready' ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                <Spinner /> Loading the search index
              </div>
            ) : !query.trim() ? (
              <p className="py-6 text-center text-muted-foreground text-sm">Type to search the docs</p>
            ) : (
              <CommandEmpty>No results for “{query.trim()}”</CommandEmpty>
            )}
            {groups.map(({ pageTitle, results }) => (
              <CommandGroup key={pageTitle} heading={pageTitle}>
                {results.map((result) => (
                  <CommandItem key={`${result.page}#${result.anchor}`} value={`${result.page}#${result.anchor}`} onSelect={() => go(result.page, result.anchor)}>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{result.heading}</div>
                      <div className="line-clamp-2 text-muted-foreground text-xs">{snippet(result.text, result.terms)}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </OpenSearch.Provider>
  );
}

const subscribeNothing = () => () => undefined;

/** The button that opens the search, with its shortcut. */
export function DocsSearchButton({ className }: { className?: string }) {
  const show = useContext(OpenSearch);
  // The shortcut depends on the platform, so it shows once the page runs in the browser.
  const keys = useSyncExternalStore(subscribeNothing, () => shortcut('K'), () => null);
  return (
    <Button variant="outline" className={className} onClick={show}>
      <SearchIcon />
      <span className="flex-1 text-left text-muted-foreground">Search</span>
      {keys && <kbd className="font-sans text-muted-foreground text-xs max-md:hidden">{keys}</kbd>}
    </Button>
  );
}

type Hit = SearchResult & DocsSection;

/** Results grouped by page, the pages in the order of their best result. */
function groupByPage(results: SearchResult[]): { pageTitle: string; results: Hit[] }[] {
  const groups = new Map<string, Hit[]>();
  for (const result of results as Hit[]) {
    const group = groups.get(result.pageTitle) ?? [];
    group.push(result);
    groups.set(result.pageTitle, group);
  }
  return [...groups].map(([pageTitle, hits]) => ({ pageTitle, results: hits }));
}

/** A piece of the section's text around the first word that matched. */
function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((term) => lower.indexOf(term.toLowerCase())).filter((i) => i >= 0), text.length);
  if (at === text.length || at < 60) {
    return text.slice(0, 160);
  }
  const start = text.lastIndexOf(' ', at - 40) + 1;
  return `…${text.slice(start, start + 160)}`;
}
