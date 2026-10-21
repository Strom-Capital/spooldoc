'use client';

import { FlaskConicalIcon, SendIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import type { ShownError } from '@/lib/client/api';
import { bytes } from '@/lib/client/format';
import { shortUrl } from '@/lib/destination-config';
import type { WebhookPreviewView, WebhookTestView } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Body lines shown before the rest folds away. */
const FOLD_LINES = 40;
/** The answer prints line by line, this fast, for its first lines; the rest prints at once. */
const PRINT_MS = 60;
const PRINT_LINES = 12;

/** One token of a printed line, colored by what it is. */
type Token = { text: string; kind?: 'key' | 'string' | 'number' | 'literal' | 'punct' | 'muted' | 'name' | 'ok' | 'bad' };
type Line = { text: string; tokens: Token[]; title?: string; flashes?: boolean };

const TOKEN_CLASS: Record<NonNullable<Token['kind']>, string> = {
  key: 'text-[var(--syntax-property)]',
  string: 'text-[var(--syntax-string)]',
  number: 'text-[var(--syntax-number)]',
  literal: 'text-[var(--syntax-keyword)]',
  punct: 'opacity-60',
  muted: 'italic opacity-60',
  name: 'opacity-70',
  ok: 'font-semibold text-emerald-700 dark:text-emerald-400',
  bad: 'font-semibold text-destructive',
};

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;

/** A line of pretty JSON as tokens. A file's content, printed as its size, reads as a note, not a string. */
function jsonTokens(line: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  let key: string | null = null;
  for (const match of line.matchAll(JSON_TOKEN)) {
    if (match.index > at) tokens.push({ text: line.slice(at, match.index) });
    const [all, string, colon, number, literal] = match;
    if (string !== undefined && colon !== undefined) {
      key = string;
      tokens.push({ text: string, kind: 'key' }, { text: colon, kind: 'punct' });
    } else if (string !== undefined) {
      tokens.push(key === '"content"' && / of base64"$/.test(string) ? { text: string.slice(1, -1), kind: 'muted' } : { text: string, kind: 'string' });
    } else if (number !== undefined) tokens.push({ text: number, kind: 'number' });
    else if (literal !== undefined) tokens.push({ text: literal, kind: 'literal' });
    else tokens.push({ text: all, kind: 'punct' });
    at = match.index + all.length;
  }
  if (at < line.length) tokens.push({ text: line.slice(at) });
  return tokens;
}

const plain = (text: string): Line => ({ text, tokens: [{ text }] });

/** Lines whose text changes with every preview, so they never flash. */
const VOLATILE = /^(webhook-id|webhook-timestamp|webhook-signature): |^\s*"timestamp": /;

/** The request as printed lines: the request line, the headers, a blank line and the body. */
function requestLines(preview: WebhookPreviewView): { head: Line[]; body: Line[] } {
  const url = new URL(preview.url);
  const head: Line[] = [
    { text: `${preview.method} ${url.pathname}${url.search} HTTP/1.1`, tokens: [{ text: preview.method, kind: 'literal' }, { text: ` ${url.pathname}${url.search} HTTP/1.1` }] },
    ...preview.headers.map((header) => {
      return { text: `${header.name}: ${header.value}`, tokens: [{ text: `${header.name}:`, kind: 'name' as const }, { text: ` ${header.value}` }] };
    }),
    plain(''),
  ];
  const body = preview.body.split('\n').map((text) => ({ text, tokens: jsonTokens(text) }));
  return { head, body };
}

/** The answer as printed lines: the status line, then the body, pretty when it is JSON. */
function responseLines(result: WebhookTestView): Line[] {
  const ok = result.status !== null && result.status >= 200 && result.status < 300;
  const status: Line =
    result.status === null
      ? { text: 'No answer', tokens: [{ text: 'No answer', kind: 'bad' }] }
      : {
          text: `HTTP/1.1 ${result.status} ${result.statusText}`,
          tokens: [{ text: 'HTTP/1.1 ' }, { text: `${result.status} ${result.statusText}`.trim(), kind: ok ? 'ok' : 'bad' }, { text: `   ${result.ms} ms`, kind: 'muted' }],
        };
  let body: Line[] = [];
  if (result.body) {
    try {
      body = JSON.stringify(JSON.parse(result.body), null, 2)
        .split('\n')
        .map((text) => ({ text, tokens: jsonTokens(text) }));
    } catch {
      body = result.body.split(/\r?\n/).map(plain);
    }
  }
  const cut = result.truncated ? [{ text: '', tokens: [{ text: '(The answer is longer; this is its first 2 KB.)', kind: 'muted' as const }] }] : [];
  return [status, ...(body.length > 0 ? [plain(''), ...body] : []), ...cut];
}

/**
 * One printed line, 20 px high. A long line wraps like a printer, at any character, onto
 * more 20 px lines, with a hanging indent so a wrapped value stays under its key.
 */
function PrintedLine({ line, flash }: { line: Line; flash?: boolean }) {
  const hang = `${(/^ */.exec(line.text)?.[0].length ?? 0) + 2}ch`;
  return (
    <div className="min-h-5 whitespace-pre-wrap [overflow-wrap:anywhere]" style={{ paddingLeft: hang, textIndent: `-${hang}` }} title={line.title}>
      <span className={cn(flash && 'flash')}>
        {line.tokens.map((token, index) => (
          <span key={index} className={token.kind && TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The tractor strips of fanfold paper: a hole every two lines, drawn by the background so
 * the paper can grow without one element per hole. A dashed rule parts them from the text.
 */
function Strip({ side }: { side: 'left' | 'right' }) {
  const style: CSSProperties = {
    backgroundImage:
      'radial-gradient(circle at 50% 20px, var(--background) var(--hole), var(--border) calc(var(--hole) + 0.5px), var(--border) calc(var(--hole) + 1px), transparent calc(var(--hole) + 1.5px))',
    backgroundSize: '100% 40px',
    backgroundPosition: '0 20px',
    backgroundRepeat: 'repeat-y',
  };
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'pointer-events-none absolute inset-y-0 w-4 border-dashed border-[var(--border)] [--hole:3.5px] sm:w-7 sm:[--hole:5px]',
        side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
      )}
    />
  );
}

/** The blue bars of continuous paper: two lines plain, two lines barred, from the first line. */
const PAPER: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 40px, color-mix(in oklab, var(--primary) 6%, transparent) 40px 80px)',
  backgroundPosition: '0 20px',
};

/** The tear line between the request and the answer, with a notch at each edge. It draws across when it first shows. */
function Perforation({ drawn }: { drawn: boolean }) {
  return (
    <div aria-hidden className="relative h-0">
      <div
        className={cn(
          'absolute inset-x-0 top-0 origin-left border-[var(--border)] border-t-2 border-dashed motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out',
          drawn ? 'scale-x-100' : 'scale-x-0',
        )}
      />
      {/* The notches are half circles drawn inside the paper's edges, so nothing sticks out of it. */}
      <span className="absolute inset-x-0 top-0 h-3 -translate-y-1/2" style={NOTCHES} />
    </div>
  );
}

const NOTCH = (side: string) =>
  `radial-gradient(circle at ${side} 50%, var(--background) 5.5px, var(--border) 6px, var(--border) 6.5px, transparent 7px)`;
const NOTCHES: CSSProperties = { backgroundImage: `${NOTCH('0')}, ${NOTCH('100%')}` };

/** The text column of the paper, inside the strips. */
function Column({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0 py-5 pr-[calc(1rem+10px)] pl-[calc(1rem+10px)] sm:pr-[calc(1.75rem+12px)] sm:pl-[calc(1.75rem+12px)]', className)}>{children}</div>;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the reader asked for less motion. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** What the Send test of the printout is doing. `seq` counts the answers, so each one prints anew. */
export interface SendTestState {
  sending: boolean;
  result: WebhookTestView | null;
  /** The call could not be made, such as a template that does not render; nothing went out. */
  error: ShownError | null;
  seq: number;
}

/**
 * The live webhook call, printed on continuous fanfold paper: the request line, the
 * headers with their values masked, and the body with real sample values and each file
 * by its size. After Send test, the perforation draws and the receiver's answer prints
 * below it, line by line. Lines that changed since the last preview light up once.
 */
export function RequestPrintout({
  preview,
  previous,
  loading,
  error,
  hasSample,
  test,
  onSendTest,
  disabled,
}: {
  preview: WebhookPreviewView | null;
  previous: WebhookPreviewView | null;
  loading: boolean;
  error: string | null;
  hasSample: boolean;
  test: SendTestState;
  onSendTest(): void;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const [unfolded, setUnfolded] = useState(false);
  const lines = useMemo(() => (preview ? requestLines(preview) : null), [preview]);
  const before = useMemo(() => (previous ? requestLines(previous) : null), [previous]);
  const answer = useMemo(() => (test.result ? responseLines(test.result) : null), [test.result]);

  // The answer prints line by line: the perforation draws in 300 ms, then 60 ms a line for the first 12, then the rest at once.
  const [progress, setProgress] = useState({ seq: 0, printed: 0, drawn: false });
  useEffect(() => {
    if (!answer || reduced) return;
    const seq = test.seq;
    const at = (ms: number, printed: number, drawn = true) => setTimeout(() => setProgress({ seq, printed, drawn }), ms);
    const timers = [at(20, 0)];
    for (let n = 1; n <= Math.min(answer.length, PRINT_LINES); n++) timers.push(at(320 + n * PRINT_MS, n));
    if (answer.length > PRINT_LINES) timers.push(at(320 + (PRINT_LINES + 1) * PRINT_MS, answer.length));
    return () => timers.forEach(clearTimeout);
  }, [answer, test.seq, reduced]);
  const current = progress.seq === test.seq ? progress : { printed: 0, drawn: false };
  const printed = reduced ? (answer?.length ?? 0) : current.printed;
  const drawn = reduced || current.drawn;

  if (!hasSample) {
    return <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">Pick a sample spooled file to see the call.</p>;
  }

  const flashes = (all: Line[], old: Line[] | undefined, index: number) =>
    old !== undefined && !VOLATILE.test(all[index]!.text) && old[index]?.text !== all[index]!.text;
  const bodyLines = lines?.body ?? [];
  const folded = !unfolded && bodyLines.length > FOLD_LINES;
  const ok = test.result !== null && test.result.status !== null && test.result.status >= 200 && test.result.status < 300;
  const announcement = test.sending
    ? 'Sending the test.'
    : test.result
      ? ok
        ? `Test sent: ${test.result.status} ${test.result.statusText} in ${test.result.ms} ms`
        : `Test failed: ${test.result.error ?? `${test.result.status} ${test.result.statusText}`}`
      : '';

  return (
    <section aria-label="Webhook call preview" className="flex min-w-0 flex-col gap-3">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div
        className="relative min-w-0 overflow-hidden rounded-sm border bg-[var(--page-paper)] font-mono text-[12.5px] text-[var(--page-ink)] leading-5 shadow-xs"
        style={PAPER}
        aria-busy={loading || undefined}
      >
        <Strip side="left" />
        <Strip side="right" />
        {lines && preview ? (
          <Column>
            <div className="tabular flex h-5 items-center justify-between gap-3 font-sans text-xs">
              <span className="opacity-70">
                Page group {preview.pageGroup + 1} of {preview.pageGroups}
                {loading && <Spinner className="ml-1.5 inline size-3 align-[-1px]" aria-label="Loading the call" />}
              </span>
              <span className="opacity-70">{bytes(preview.bodyBytes)}</span>
            </div>
            {lines.head.map((line, index) => (
              <PrintedLine key={`h${index}:${line.text}`} line={line} flash={flashes(lines.head, before?.head, index)} />
            ))}
            {(folded ? bodyLines.slice(0, FOLD_LINES) : bodyLines).map((line, index) => (
              <PrintedLine key={`b${index}:${line.text}`} line={line} flash={flashes(bodyLines, before?.body, index)} />
            ))}
            {bodyLines.length > FOLD_LINES && (
              <div className="h-5 font-sans text-xs">
                <button type="button" onClick={() => setUnfolded(!unfolded)} className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  {folded ? `Show all ${bodyLines.length} lines` : `Fold to ${FOLD_LINES} lines`}
                </button>
              </div>
            )}
          </Column>
        ) : (
          <Column>
            <div className="flex flex-col gap-2 py-0.5" aria-label="Loading the call">
              {[45, 80, 60, 72, 55, 0, 30, 66, 50, 70, 40].map((width, index) =>
                width === 0 ? <div key={index} className="h-3" /> : <Skeleton key={index} className="h-3 bg-[var(--page-ink)]/10" style={{ width: `${width}%` }} />,
              )}
            </div>
          </Column>
        )}
        {answer && (
          <Fragment key={test.seq}>
            <Perforation drawn={drawn} />
            <Column className="motion-safe:animate-[paper-feed_300ms_ease-out]">
              {answer.slice(0, printed).map((line, index) => (
                <PrintedLine key={`r${test.seq}:${index}`} line={line} />
              ))}
              {/* Space for the lines still to print, so the paper does not jump. */}
              {printed < answer.length && <div aria-hidden style={{ height: (answer.length - printed) * 20 }} />}
            </Column>
          </Fragment>
        )}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {test.result?.error && <ErrorNote detail={test.result.detail}>{test.result.error}</ErrorNote>}
      {test.error && <ErrorNote detail={test.error.detail}>{test.error.message}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Hint text="Sends this page group to the URL now, marked as a test (document.test). One try, and nothing goes in the Job log.">
          <Button type="button" variant="outline" onClick={onSendTest} disabled={disabled || test.sending || !preview}>
            {test.sending ? <Spinner /> : <SendIcon />}
            {test.sending ? 'Sending...' : 'Send test'}
          </Button>
        </Hint>
        {preview?.testMode && (
          <span className="flex min-w-0 items-center gap-1.5 text-amber-700 text-xs dark:text-amber-400">
            <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">Test mode: calls go to {shortUrl(preview.url)}, without the header values.</span>
          </span>
        )}
      </div>
    </section>
  );
}
