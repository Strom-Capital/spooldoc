'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText } from '@/lib/client/api';
import type { FieldHit, RenderResult } from '@/lib/client/render';

/** Middle pane tabs. */
export type WorkbenchTab = 'json' | 'definition' | 'template';

/** Unsaved editor contents. `null` means "use the saved file". */
export interface Drafts {
  yaml: string | null;
  html: string | null;
}

export interface WorkbenchState {
  sampleId: string;
  render: RenderResult | null;
  /** A failed load or preview (the render result's own errors are in `render.errors`). */
  error: string | null;
  loading: boolean;
  /** Fetch again with the saved files plus any unsaved drafts. */
  reload(): Promise<void>;
  /** Set drafts and render with them. */
  preview(overrides?: Partial<Drafts>): Promise<void>;
  drafts: Drafts;
  setDraft(kind: keyof Drafts, value: string | null): void;
  selectedHit: FieldHit | null;
  setSelectedHit(hit: FieldHit | null): void;
  /** Sample page number shown in the page view. */
  page: number;
  setPage(page: number): void;
  /** 0-based document shown in the JSON view and the HTML preview. */
  documentIndex: number;
  setDocumentIndex(index: number): void;
  tab: WorkbenchTab;
  setTab(tab: WorkbenchTab): void;
}

const WorkbenchContext = createContext<WorkbenchState | null>(null);

/** GET the saved render, or POST with drafts. */
function fetchRender(sampleId: string, drafts: Drafts, document: number): Promise<RenderResult> {
  const path = `/api/render/${encodeURIComponent(sampleId)}`;
  if (drafts.yaml === null && drafts.html === null) {
    return api<RenderResult>(`${path}?document=${document}`);
  }
  return api<RenderResult>(path, {
    method: 'POST',
    body: { yaml: drafts.yaml ?? undefined, html: drafts.html ?? undefined, document },
  });
}

/**
 * State shared by the workbench panes: the render result, drafts, the selected hit,
 * the page and the document. Later panes (the chat) read and drive the same state.
 */
export function WorkbenchProvider({ sampleId, children }: { sampleId: string; children: ReactNode }) {
  const [render, setRender] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Drafts>({ yaml: null, html: null });
  const [selectedHit, setSelectedHit] = useState<FieldHit | null>(null);
  const [page, setPage] = useState(1);
  const [documentIndex, setDocumentIndexState] = useState(0);
  const [tab, setTab] = useState<WorkbenchTab>('json');
  const draftsRef = useRef(drafts);
  const documentRef = useRef(documentIndex);
  const requestRef = useRef(0);

  const load = useCallback(
    async (next: Drafts, document: number) => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const result = await fetchRender(sampleId, next, document);
        if (request === requestRef.current) {
          setRender(result);
          setError(null);
        }
      } catch (err) {
        if (request === requestRef.current) {
          setError(errorText(err));
        }
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
        }
      }
    },
    [sampleId],
  );

  const setDraft = useCallback((kind: keyof Drafts, value: string | null) => {
    draftsRef.current = { ...draftsRef.current, [kind]: value };
    setDrafts(draftsRef.current);
  }, []);

  const reload = useCallback(() => load(draftsRef.current, documentRef.current), [load]);

  const preview = useCallback(
    (overrides: Partial<Drafts> = {}) => {
      draftsRef.current = { ...draftsRef.current, ...overrides };
      setDrafts(draftsRef.current);
      return load(draftsRef.current, documentRef.current);
    },
    [load],
  );

  const setDocumentIndex = useCallback(
    (index: number) => {
      documentRef.current = index;
      setDocumentIndexState(index);
      void load(draftsRef.current, index);
    },
    [load],
  );

  useEffect(() => {
    const request = ++requestRef.current;
    fetchRender(sampleId, { yaml: null, html: null }, 0).then(
      (result) => {
        if (request !== requestRef.current) return;
        setRender(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (request !== requestRef.current) return;
        setError(errorText(err));
        setLoading(false);
      },
    );
  }, [sampleId]);

  return (
    <WorkbenchContext.Provider
      value={{
        sampleId,
        render,
        error,
        loading,
        reload,
        preview,
        drafts,
        setDraft,
        selectedHit,
        setSelectedHit,
        page,
        setPage,
        documentIndex,
        setDocumentIndex,
        tab,
        setTab,
      }}
    >
      {children}
    </WorkbenchContext.Provider>
  );
}

/** The workbench state. */
export function useWorkbench(): WorkbenchState {
  const value = useContext(WorkbenchContext);
  if (!value) {
    throw new Error('useWorkbench needs a WorkbenchProvider');
  }
  return value;
}
