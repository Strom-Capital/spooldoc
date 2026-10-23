'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText } from '@/lib/client/api';
import type { Lookup } from '@spooldoc/core/lookups';
import { perSpooledFile, type TemplateContent, type XlsxScope } from '@/lib/job-spec';
import { groupOfPage, type FieldHit, type RenderResult } from '@/lib/client/render';

/** Editor tabs: the Extract step shows the definition and the JSON, Render the template and the JSON. */
export type WorkbenchTab = 'json' | 'definition' | 'template';

export interface WorkbenchState {
  jobId: string;
  /** The preview spooled file, or null when none is picked yet. */
  sampleId: string | null;
  /** The definition and the template's content shown and rendered. */
  yaml: string;
  content: TemplateContent;
  /** The HTML template's text; null for the starter template and for a Word or Excel template. */
  html: string | null;
  /** The template as render and file requests send it: HTML text, or the Word or Excel template's file. */
  templateRequest: { html: string | null } | { docx: { fileId: string | null } } | { xlsx: { fileId: string | null; scope: XlsxScope } };
  /** The job template whose content this is, and picking another. */
  templateId: string;
  setTemplateId(id: string): void;
  readOnly: boolean;
  setYaml(yaml: string): void;
  /** Change the HTML template; null goes back to the starter template. */
  setHtml(html: string | null): void;
  /** Use other content: switch kinds, or point at another Word or Excel file. */
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
  /** Sample page number shown in the page view. Another page can pick another page group. */
  page: number;
  /** Show `page`; `pageGroup` picks which page group when the page is in more than one. */
  setPage(page: number, pageGroup?: number): void;
  /** 0-based page group shown in the JSON view and the preview. Another page group can move the page. */
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
  lookups,
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
  /** The job's lookups, saved or not; the render runs the tested ones. */
  lookups: Lookup[];
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
  const [page, setPageOnly] = useState(1);
  const [pageGroupIndex, setPageGroupOnly] = useState(0);
  const [tab, setTab] = useState<WorkbenchTab>('definition');
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; render: RenderResult | null; error: string | null } | null>(null);

  // A new preview file starts on its first page.
  const [shownSample, setShownSample] = useState(sampleId);
  if (sampleId !== shownSample) {
    setShownSample(sampleId);
    setPageOnly(1);
    setPageGroupOnly(0);
    setSelectedHit(null);
  }

  const html = content.kind === 'html' ? content.source : null;
  const fileId = content.kind === 'html' ? null : content.fileId;
  const scope = content.kind === 'xlsx' ? content.scope : null;
  const templateRequest = useMemo(
    () => (content.kind === 'html' ? { html } : content.kind === 'xlsx' ? { xlsx: { fileId, scope: scope ?? 'splf' } } : { docx: { fileId } }),
    [content.kind, html, fileId, scope],
  );
  const setHtml = useCallback((source: string | null) => setContent({ kind: 'html', source }), [setContent]);
  // An Excel template of the whole spooled file renders every page group, whichever is shown.
  const renderedGroup = perSpooledFile(content) ? 0 : pageGroupIndex;

  // Text changes render after a pause; a new file, page group, template, kind, file or scope, or a reload, at once.
  const text = useDebounced(JSON.stringify({ yaml, lookups, ...templateRequest, templateId }), RENDER_DELAY_MS, `${templateId}:${content.kind}:${fileId}:${scope}`);
  const requestKey = JSON.stringify([jobId, sampleId, renderedGroup, nonce, text]);

  useEffect(() => {
    if (!sampleId) {
      return;
    }
    let cancelled = false;
    const body = JSON.parse(text) as Record<string, unknown>;
    api<RenderResult>(`/api/jobs/${jobId}/render`, { method: 'POST', body: { sampleId, ...body, pageGroup: renderedGroup } }).then(
      (render) => !cancelled && setResult({ key: requestKey, render, error: null }),
      (err: unknown) => !cancelled && setResult((prev) => ({ key: requestKey, render: prev?.render ?? null, error: errorText(err) })),
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, jobId, sampleId, renderedGroup, text]);

  const render = sampleId ? (result?.render ?? null) : null;
  const error = sampleId ? (result?.error ?? null) : null;
  const loading = !!sampleId && result?.key !== requestKey;
  const reload = useCallback(async () => setNonce((n) => n + 1), []);

  // The page and the page group follow each other: each keeps its value while the other still fits.
  const ranges = render?.extract?.pageRanges;
  const setPage = useCallback(
    (next: number, pageGroup?: number) => {
      setPageOnly(next);
      const group = ranges ? groupOfPage(ranges, next, pageGroup ?? pageGroupIndex) : -1;
      if (group >= 0) setPageGroupOnly(group);
    },
    [ranges, pageGroupIndex],
  );
  const setPageGroupIndex = useCallback(
    (next: number) => {
      setPageGroupOnly(next);
      const range = ranges?.[next];
      if (range && (page < range.first || page > range.last)) setPageOnly(range.first);
    },
    [ranges, page],
  );
  // A changed definition can move the page groups: keep the page and pick its page group.
  const [shownRanges, setShownRanges] = useState(ranges);
  if (ranges !== shownRanges) {
    setShownRanges(ranges);
    const group = ranges ? groupOfPage(ranges, page, pageGroupIndex) : -1;
    if (group >= 0 && group !== pageGroupIndex) setPageGroupOnly(group);
  }

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
