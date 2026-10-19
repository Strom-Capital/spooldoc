'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText } from '@/lib/client/api';
import type { TemplateContent } from '@/lib/job-spec';
import type { FieldHit, RenderResult } from '@/lib/client/render';

/** Editor tabs: the Extract step shows the definition and the JSON, Render the template and the JSON. */
export type WorkbenchTab = 'json' | 'definition' | 'template';

export interface WorkbenchState {
  jobId: string;
  /** The preview spooled file, or null when none is picked yet. */
  sampleId: string | null;
  /** The definition and the template's content shown and rendered. */
  yaml: string;
  content: TemplateContent;
  /** The HTML template's text; null for the starter template and for a Word template. */
  html: string | null;
  /** The template as render and file requests send it: HTML text, or the Word template's file. */
  templateRequest: { html: string | null } | { docx: { fileId: string | null } };
  /** The job template whose content this is, and picking another. */
  templateId: string;
  setTemplateId(id: string): void;
  readOnly: boolean;
  setYaml(yaml: string): void;
  /** Change the HTML template; null goes back to the starter template. */
  setHtml(html: string | null): void;
  /** Use other content: switch kinds, or point at another Word file. */
  setContent(content: TemplateContent): void;
  render: RenderResult | null;
  /** A failed render request (the render result's own errors are in `render.errors`). */
  error: string | null;
  loading: boolean;
  /** Render again. */
  reload(): Promise<void>;
  /** Called when the chat wrote the draft on the server. */
  onDraftWritten(): Promise<void>;
  selectedHit: FieldHit | null;
  setSelectedHit(hit: FieldHit | null): void;
  /** Sample page number shown in the page view. */
  page: number;
  setPage(page: number): void;
  /** 0-based page group shown in the JSON view and the preview. */
  pageGroupIndex: number;
  setPageGroupIndex(index: number): void;
  tab: WorkbenchTab;
  setTab(tab: WorkbenchTab): void;
}

const WorkbenchContext = createContext<WorkbenchState | null>(null);

/** How long to wait after typing before rendering again. */
const RENDER_DELAY_MS = 400;

/** `value`, once it has not changed for `ms`; at once when `key` changes. */
function useDebounced<T>(value: T, ms: number, key: unknown): T {
  const [settled, setSettled] = useState({ value, key });
  if (key !== settled.key) {
    setSettled({ value, key });
  }
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ value, key }), ms);
    return () => clearTimeout(timer);
  }, [value, ms, key]);
  return key === settled.key ? settled.value : value;
}

/**
 * State shared by the Extract and Render panes and the chat: the render of the preview
 * spooled file with the current definition and template, the selected hit, the page
 * and the page group. It renders again shortly after the definition or template changes.
 */
export function WorkbenchProvider({
  jobId,
  sampleId,
  yaml,
  content,
  templateId,
  setTemplateId,
  readOnly,
  setYaml,
  setContent,
  onDraftWritten,
  children,
}: {
  jobId: string;
  sampleId: string | null;
  yaml: string;
  content: TemplateContent;
  templateId: string;
  setTemplateId(id: string): void;
  readOnly: boolean;
  setYaml(yaml: string): void;
  setContent(content: TemplateContent): void;
  onDraftWritten(): Promise<void>;
  children: ReactNode;
}) {
  const [selectedHit, setSelectedHit] = useState<FieldHit | null>(null);
  const [page, setPage] = useState(1);
  const [pageGroupIndex, setPageGroupIndex] = useState(0);
  const [tab, setTab] = useState<WorkbenchTab>('definition');
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; render: RenderResult | null; error: string | null } | null>(null);

  // A new preview file starts on its first page.
  const [shownSample, setShownSample] = useState(sampleId);
  if (sampleId !== shownSample) {
    setShownSample(sampleId);
    setPage(1);
    setSelectedHit(null);
  }

  const html = content.kind === 'html' ? content.source : null;
  const fileId = content.kind === 'docx' ? content.fileId : null;
  const templateRequest = useMemo(() => (content.kind === 'html' ? { html } : { docx: { fileId } }), [content.kind, html, fileId]);
  const setHtml = useCallback((source: string | null) => setContent({ kind: 'html', source }), [setContent]);

  // Text changes render after a pause; a new file, page group, template, kind or Word file, or a reload, at once.
  const text = useDebounced(JSON.stringify({ yaml, ...templateRequest, templateId }), RENDER_DELAY_MS, `${templateId}:${content.kind}:${fileId}`);
  const requestKey = JSON.stringify([jobId, sampleId, pageGroupIndex, nonce, text]);

  useEffect(() => {
    if (!sampleId) {
      return;
    }
    let cancelled = false;
    const body = JSON.parse(text) as Record<string, unknown>;
    api<RenderResult>(`/api/jobs/${jobId}/render`, { method: 'POST', body: { sampleId, ...body, pageGroup: pageGroupIndex } }).then(
      (render) => !cancelled && setResult({ key: requestKey, render, error: null }),
      (err: unknown) => !cancelled && setResult((prev) => ({ key: requestKey, render: prev?.render ?? null, error: errorText(err) })),
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, jobId, sampleId, pageGroupIndex, text]);

  const render = sampleId ? (result?.render ?? null) : null;
  const error = sampleId ? (result?.error ?? null) : null;
  const loading = !!sampleId && result?.key !== requestKey;
  const reload = useCallback(async () => setNonce((n) => n + 1), []);

  return (
    <WorkbenchContext.Provider
      value={{
        jobId,
        sampleId,
        yaml,
        content,
        html,
        templateRequest,
        templateId,
        setTemplateId,
        readOnly,
        setYaml,
        setHtml,
        setContent,
        render,
        error,
        loading,
        reload,
        onDraftWritten,
        selectedHit,
        setSelectedHit,
        page,
        setPage,
        pageGroupIndex,
        setPageGroupIndex,
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
