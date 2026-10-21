'use client';

import { ChevronLeftIcon, ChevronRightIcon, FlaskConicalIcon, FolderIcon, RefreshCwIcon, UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoxHeader, useReducedMotion } from '@/components/code-box';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { api, ApiError, shownError, type ShownError } from '@/lib/client/api';
import { ago, bytes, duration } from '@/lib/client/format';
import { IF_EXISTS_TEXT, SFTP_LIST_LIMIT } from '@/lib/destination-config';
import type { DestinationView, SftpEntryView, SftpFolderView, SftpOutcome, SftpUploadTestView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useJob } from './job-provider';

type SftpDestination = Extract<DestinationView, { kind: 'sftp' }>;

/** How long the folder view waits after a change before it asks again. */
const PREVIEW_DELAY_MS = 400;
/** Files shown on each side of the page group's files. */
const NEIGHBORS = 3;
/** Files a click on a gap shows. */
const EXPAND = 50;
/** Upload test turns each row solid this fast, one after the other. */
const LAND_MS = 120;

/** A row of the folder: a file already there, or a file of the page group with what a run does to it. */
type Row = { kind: 'entry'; name: string; entry: SftpEntryView } | { kind: 'own'; name: string; file: string; outcome: SftpOutcome };

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The folder's rows in the order the server sorts them, with the page group's files placed among them. */
function folderRows(view: SftpFolderView): Row[] {
  const own: Row[] = view.files.map((file) => ({ kind: 'own', name: file.outcome.kind === 'becomes' ? file.outcome.name : file.name, file: file.name, outcome: file.outcome }));
  // A file a run replaces, or that fails it, is the page group's row.
  const merged = new Set(view.files.filter((file) => file.outcome.kind === 'replaces' || file.outcome.kind === 'fails').map((file) => file.name.toLowerCase()));
  const entries: Row[] = view.entries.filter((entry) => !merged.has(entry.name.toLowerCase())).map((entry) => ({ kind: 'entry', name: entry.name, entry }));
  return [...entries, ...own].sort(byName);
}

/** "14 Oct". */
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** "14 Oct 09:12". */
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** What a run does to a file, as its tag. */
function outcomeText(outcome: SftpOutcome): string {
  if (outcome.kind === 'new') return 'New';
  if (outcome.kind === 'replaces') return outcome.mtime ? `Replaces the file from ${day(outcome.mtime)}` : 'Replaces the file there';
  if (outcome.kind === 'becomes') return `Becomes ${outcome.name}`;
  return 'Fails the run: the name is taken';
}

/** "1 file", "140 files". */
const nFiles = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;

/** The folder of a page group, asked for again when the job or the destination changes (after a pause), another page group is picked, or Refresh. */
function useSftpFolder(destination: SftpDestination, pageGroupIndex: number, refreshes: number) {
  const { job, spec } = useJob();
  const { sampleId, yaml } = useWorkbench();
  const [state, setState] = useState<{ view: SftpFolderView | null; error: (ShownError & { untrusted?: boolean }) | null; loading: boolean }>({
    view: null,
    error: null,
    loading: false,
  });
  // The definition, the templates and the destination's settings are part of the key, so the view follows a change to any of them.
  const body = useMemo(
    () => JSON.stringify({ request: { destinationId: destination.id, pageGroupIndex, sampleId: sampleId ?? undefined }, yaml, templates: spec.render.templates, config: destination.config }),
    [destination.id, destination.config, pageGroupIndex, sampleId, yaml, spec.render.templates],
  );
  const last = useRef({ group: pageGroupIndex, refreshes });
  useEffect(() => {
    if (!sampleId) return;
    let cancelled = false;
    // Stepping to another page group and Refresh ask at once; other changes wait for a pause.
    const refresh = last.current.refreshes !== refreshes;
    const delay = last.current.group !== pageGroupIndex || refresh ? 0 : PREVIEW_DELAY_MS;
    last.current = { group: pageGroupIndex, refreshes };
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      const { request } = JSON.parse(body) as { request: Record<string, unknown> };
      api<SftpFolderView>(`/api/jobs/${job.id}/sftp-folder`, { method: 'POST', body: { ...request, refresh } }).then(
        (view) => !cancelled && setState({ view, error: null, loading: false }),
        (err: unknown) =>
          !cancelled &&
          setState((current) => ({
            ...current,
            error: { ...shownError(err), untrusted: err instanceof ApiError && (err.body as { untrusted?: boolean } | undefined)?.untrusted === true },
            loading: false,
          })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, job.id, pageGroupIndex, sampleId, refreshes]);
  return state;
}

/** The time since the folder was read, kept current. */
function useNow(every = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** One row of the folder box. */
function FolderRow({ row, landed }: { row: Row; landed: SftpUploadTestView['files'][number] | null | undefined }) {
  if (row.kind === 'entry') {
    const { entry } = row;
    return (
      <div className="flex min-h-5 min-w-0 items-center gap-3 border-transparent border-l-2 px-3 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={entry.name}>
          {entry.folder ? (
            <>
              <FolderIcon aria-hidden className="mr-1 inline size-3 align-[-1px]" />
              {entry.name}/
            </>
          ) : (
            entry.name
          )}
        </span>
        {!entry.folder && <span className="tabular hidden w-16 shrink-0 text-right font-sans sm:inline">{bytes(entry.size)}</span>}
        <span className="tabular hidden w-28 shrink-0 text-right font-sans sm:inline">{when(entry.mtime)}</span>
      </div>
    );
  }
  const fails = row.outcome.kind === 'fails';
  const done = landed && !landed.error;
  return (
    <div
      className={cn(
        'my-px flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 border-l-2 px-3 transition-colors duration-300',
        fails ? 'border-l-destructive' : 'border-l-primary',
        done ? 'bg-primary/10' : 'bg-primary/[0.03] outline-1 outline-primary/30 outline-dashed -outline-offset-1',
        landed?.error && 'bg-destructive/10 outline-destructive/40',
      )}
    >
      <span className="min-w-0 truncate font-medium text-foreground" title={row.name}>
        {row.name}
      </span>
      <span className={cn('min-w-0 flex-1 font-sans', fails || landed?.error ? 'text-destructive' : 'text-primary')}>
        {landed?.error ? 'Failed' : done ? 'Uploaded' : outcomeText(row.outcome)}
      </span>
      {done && (
        <span className="tabular shrink-0 font-sans text-muted-foreground">
          {bytes(landed.size)} in {duration(landed.ms)}
        </span>
      )}
    </div>
  );
}

/**
 * The folder on the server, listed live, with the page group's files placed among the files
 * already there, each tagged with what a run will do. Up to three neighbors show on each
 * side; a gap says how many files it skips and opens 50 at a time.
 */
function FolderBox({
  view,
  loading,
  onRefresh,
  landed,
}: {
  view: SftpFolderView;
  loading: boolean;
  onRefresh(): void;
  landed: Map<string, SftpUploadTestView['files'][number]> | null;
}) {
  const now = useNow();
  const rows = useMemo(() => folderRows(view), [view]);
  // Rows a gap shows after clicks, by the index its gap starts at.
  const [opened, setOpened] = useState<Record<number, number>>({});
  const near = useMemo(() => {
    const keep = new Set<number>();
    rows.forEach((row, index) => {
      if (row.kind !== 'own') return;
      for (let at = Math.max(0, index - NEIGHBORS); at <= Math.min(rows.length - 1, index + NEIGHBORS); at++) keep.add(at);
    });
    return keep;
  }, [rows]);

  // The rows to print: kept rows, and for each run of skipped rows, what was opened and a gap.
  const out: ({ kind: 'row'; row: Row; index: number } | { kind: 'gap'; start: number; count: number })[] = [];
  for (let index = 0; index < rows.length; ) {
    if (near.has(index)) {
      out.push({ kind: 'row', row: rows[index]!, index });
      index++;
      continue;
    }
    let end = index;
    while (end < rows.length && !near.has(end)) end++;
    const shown = Math.min(opened[index] ?? 0, end - index);
    for (let at = index; at < index + shown; at++) out.push({ kind: 'row', row: rows[at]!, index: at });
    if (index + shown < end) out.push({ kind: 'gap', start: index, count: end - index - shown });
    index = end;
  }
  const empty = view.entries.length === 0;

  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background font-mono text-foreground text-xs leading-5" aria-busy={loading || undefined}>
      <BoxHeader
        left={
          <span className="break-all font-mono text-foreground">
            {view.target}
            {loading && <Spinner className="ml-1.5 inline size-3 align-[-1px]" aria-label="Reading the folder" />}
          </span>
        }
        right={
          <span className="flex items-center gap-1">
            <span>Read {ago(view.readAt, now)}</span>
            <Hint text="Reads the folder on the server again. Stepping through page groups uses the listing of the last minute.">
              <Button type="button" variant="ghost" size="icon-xs" onClick={onRefresh} disabled={loading} aria-label="Read the folder again">
                <RefreshCwIcon />
              </Button>
            </Hint>
          </span>
        }
      />
      <div className="flex flex-col py-2">
        {empty && <p className="px-3 pb-1 font-sans text-muted-foreground">The folder is empty.</p>}
        {out.map((item) =>
          item.kind === 'gap' ? (
            <div key={`gap${item.start}`} className="flex min-h-5 items-center border-transparent border-l-2 px-3 font-sans">
              <Hint text={`Shows ${Math.min(EXPAND, item.count)} more of the files here.`}>
                <button
                  type="button"
                  onClick={() => setOpened((current) => ({ ...current, [item.start]: (current[item.start] ?? 0) + EXPAND }))}
                  className="rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  ⋯ {nFiles(item.count)}
                </button>
              </Hint>
            </div>
          ) : (
            <FolderRow key={`${item.row.kind}:${item.row.name}`} row={item.row} landed={item.row.kind === 'own' ? landed?.get(item.row.file) : undefined} />
          ),
        )}
        {view.truncated && (
          <p className="px-3 pt-1 font-sans text-muted-foreground">Read the first {SFTP_LIST_LIMIT.toLocaleString('en-US')} files of the folder.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The SFTP part of the destination step: the page group to show beside the folder on the
 * server, listed live, with the page group's files placed and tagged, and Upload test,
 * which puts them in the test folder.
 */
export function SftpStep({ destination }: { destination: SftpDestination }) {
  const { job, readOnly } = useJob();
  const { pageGroupIndex, sampleId } = useWorkbench();
  const reduced = useReducedMotion();
  const [pageGroup, setPageGroup] = useState(pageGroupIndex);
  const [refreshes, setRefreshes] = useState(0);
  const { view, error, loading } = useSftpFolder(destination, pageGroup, refreshes);
  const [test, setTest] = useState<{ uploading: boolean; result: SftpUploadTestView | null; error: ShownError | null; landed: number; group: number }>({
    uploading: false,
    result: null,
    error: null,
    landed: 0,
    group: -1,
  });
  const shown = view?.pageGroup ?? pageGroup;
  const total = view?.pageGroups ?? null;
  const testFolder = destination.config.testFolder;

  // The uploaded rows turn solid one after the other.
  useEffect(() => {
    if (!test.result || reduced) return;
    const timers = test.result.files.map((_, index) => setTimeout(() => setTest((current) => ({ ...current, landed: index + 1 })), (index + 1) * LAND_MS));
    return () => timers.forEach(clearTimeout);
  }, [test.result, reduced]);
  const landed = useMemo(() => {
    if (!test.result || test.group !== shown) return null;
    const count = reduced ? test.result.files.length : test.landed;
    return new Map(test.result.files.slice(0, count).map((file) => [file.name, file]));
  }, [test, shown, reduced]);

  async function uploadTest() {
    setTest((current) => ({ ...current, uploading: true, error: null }));
    try {
      const result = await api<SftpUploadTestView>(`/api/jobs/${job.id}/sftp-test`, {
        method: 'POST',
        body: { destinationId: destination.id, pageGroupIndex: shown, sampleId: sampleId ?? undefined },
      });
      setTest({ uploading: false, result, error: null, landed: 0, group: shown });
    } catch (err) {
      // A 502 with files is the server's answer for each file: it shows on the rows.
      const body = err instanceof ApiError && err.status === 502 ? (err.body as SftpUploadTestView | undefined) : undefined;
      if (body && Array.isArray(body.files)) setTest({ uploading: false, result: body, error: null, landed: 0, group: shown });
      else setTest((current) => ({ ...current, uploading: false, error: shownError(err) }));
    }
    // The listing is read again, so the files that landed show as they are on the server.
    setRefreshes((n) => n + 1);
  }

  const failedFiles = test.result?.files.filter((file) => file.error) ?? [];
  const uploaded = (test.result?.files.length ?? 0) - failedFiles.length;
  const announcement = test.uploading
    ? 'Uploading the test.'
    : test.result
      ? failedFiles.length > 0
        ? `Uploaded ${uploaded} of ${nFiles(test.result.files.length)}. ${failedFiles[0]!.error}`
        : `Uploaded ${nFiles(uploaded)} in ${duration(test.result.ms)}`
      : '';

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-medium text-sm">Page group</span>
        <div className="flex items-center gap-1">
          <Hint text="Show the files of the page group before this one.">
            <Button type="button" variant="outline" size="icon-sm" disabled={shown === 0} onClick={() => setPageGroup(shown - 1)} aria-label="Previous page group">
              <ChevronLeftIcon />
            </Button>
          </Hint>
          <span className="tabular min-w-28 text-center text-sm" aria-live="polite">
            {total === null ? `Page group ${shown + 1}` : `${shown + 1} of ${total}`}
          </span>
          <Hint text="Show the files of the next page group.">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={total === null || shown >= total - 1}
              onClick={() => setPageGroup(shown + 1)}
              aria-label="Next page group"
            >
              <ChevronRightIcon />
            </Button>
          </Hint>
        </div>
        <p className="text-muted-foreground text-xs">
          Each document&apos;s files go to the folder on the server. {IF_EXISTS_TEXT[destination.config.ifExists]}{' '}
          <Link href="/docs/destinations#sftp" className="text-primary hover:underline">
            What happens to each file
          </Link>
        </p>
      </div>
      <section aria-label="Folder on the server" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0">
        {!sampleId ? (
          <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">Pick a sample spooled file to see the folder.</p>
        ) : error && !view ? (
          <ErrorNote
            detail={error.detail}
            action={
              error.untrusted ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/destinations">Open the destination</Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setRefreshes((n) => n + 1)}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              )
            }
          >
            {error.message}
          </ErrorNote>
        ) : view ? (
          <>
            {error && <ErrorNote detail={error.detail}>{error.message}</ErrorNote>}
            <FolderBox key={`${view.pageGroup}:${view.folder}`} view={view} loading={loading} onRefresh={() => setRefreshes((n) => n + 1)} landed={landed} />
          </>
        ) : (
          <div className="min-w-0 overflow-hidden rounded-md border bg-background text-xs" aria-busy>
            <BoxHeader left="Reading the folder..." right="" />
            <div className="flex flex-col gap-2 px-3 py-3" aria-label="Reading the folder">
              {[55, 62, 48, 70, 58, 66, 50].map((width, index) => (
                <Skeleton key={index} className="h-3" style={{ width: `${width}%` }} />
              ))}
            </div>
          </div>
        )}
        {sampleId && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Hint
              text={
                testFolder
                  ? `Uploads this page group's files to the test folder ${testFolder} now. Nothing goes in the Job log.`
                  : 'Set a test folder on the destination first, so a test never lands where the receiver picks up files.'
              }
            >
              <Button type="button" variant="outline" onClick={() => void uploadTest()} disabled={readOnly || !testFolder || test.uploading || !view}>
                {test.uploading ? <Spinner /> : <UploadIcon />}
                {test.uploading ? 'Uploading...' : 'Upload test'}
              </Button>
            </Hint>
            {testFolder ? (
              <span className="flex min-w-0 items-center gap-1.5 text-amber-700 text-xs dark:text-amber-400">
                <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  Test: files go to <span className="font-mono">{testFolder}</span>
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Upload test needs a test folder on the destination.</span>
            )}
            {test.result && test.group === shown && failedFiles.length === 0 && (
              <span className="tabular text-muted-foreground text-xs">
                Uploaded {nFiles(uploaded)} in {duration(test.result.ms)}
              </span>
            )}
          </div>
        )}
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {failedFiles.length > 0 && (
          <ErrorNote detail={failedFiles[0]!.detail}>
            Could not upload {failedFiles[0]!.name}. {failedFiles[0]!.error}
          </ErrorNote>
        )}
        {test.error && <ErrorNote detail={test.error.detail}>{test.error.message}</ErrorNote>}
      </section>
    </div>
  );
}
