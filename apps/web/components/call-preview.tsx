'use client';

import { FlaskConicalIcon, SendIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { BoxHeader, CodeLine, gutterWidth, plain, useReducedMotion, type Line, type Token } from '@/components/code-box';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import type { ShownError } from '@/lib/client/api';
import { bytes, duration } from '@/lib/client/format';
import { shortUrl } from '@/lib/destination-config';
import type { WebhookPreviewView, WebhookTestView } from '@/lib/types';

/** Body lines shown before the rest folds away. */
const FOLD_LINES = 40;
/** The answer prints line by line, this fast, for its first lines; the rest prints at once. */
const PRINT_MS = 60;
const PRINT_LINES = 12;

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

/** Lines whose text changes with every preview, so they never flash. */
const VOLATILE = /^(webhook-id|webhook-timestamp|webhook-signature): |^\s*"timestamp": /;

/** The request as lines: the request line, the headers, a blank line and the body. */
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

/** The answer as lines: the status line, then the body, pretty when it is JSON. */
function responseLines(result: WebhookTestView): Line[] {
  const ok = result.status !== null && result.status >= 200 && result.status < 300;
  const status: Line =
    result.status === null
      ? { text: 'No answer', tokens: [{ text: 'No answer', kind: 'bad' }] }
      : {
          text: `HTTP/1.1 ${result.status} ${result.statusText}`,
          tokens: [{ text: 'HTTP/1.1 ' }, { text: `${result.status} ${result.statusText}`.trim(), kind: ok ? 'ok' : 'bad' }],
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


/** What the Send test of the preview is doing. `seq` counts the answers, so each one prints anew. */
export interface SendTestState {
  sending: boolean;
  result: WebhookTestView | null;
  /** The call could not be made, such as a template that does not render; nothing went out. */
  error: ShownError | null;
  seq: number;
}

/**
 * The live webhook call, as the app shows code: the request line, the headers with their
 * values masked, and the body with real sample values and each file by its size, with
 * line numbers. After Send test, the receiver's answer prints below it, line by line.
 * Lines that changed since the last preview light up once.
 */
export function CallPreview({
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

  // The answer prints line by line: 60 ms a line for the first 12, then the rest at once.
  const [progress, setProgress] = useState({ seq: 0, printed: 0 });
  useEffect(() => {
    if (!answer || reduced) return;
    const seq = test.seq;
    const at = (ms: number, printed: number) => setTimeout(() => setProgress({ seq, printed }), ms);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let n = 1; n <= Math.min(answer.length, PRINT_LINES); n++) timers.push(at(n * PRINT_MS, n));
    if (answer.length > PRINT_LINES) timers.push(at((PRINT_LINES + 1) * PRINT_MS, answer.length));
    return () => timers.forEach(clearTimeout);
  }, [answer, test.seq, reduced]);
  const printed = reduced ? (answer?.length ?? 0) : progress.seq === test.seq ? progress.printed : 0;

  if (!hasSample) {
    return <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">Pick a sample spooled file to see the call.</p>;
  }

  const flashes = (all: Line[], old: Line[] | undefined, index: number) =>
    old !== undefined && !VOLATILE.test(all[index]!.text) && old[index]?.text !== all[index]!.text;
  const head = lines?.head ?? [];
  const bodyLines = lines?.body ?? [];
  const folded = !unfolded && bodyLines.length > FOLD_LINES;
  const shownBody = folded ? bodyLines.slice(0, FOLD_LINES) : bodyLines;
  const requestGutter = gutterWidth(head.length + shownBody.length);
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
      <div className="min-w-0 overflow-hidden rounded-md border bg-background font-mono text-foreground text-xs leading-5" aria-busy={loading || undefined}>
        {lines && preview ? (
          <>
            <BoxHeader
              left={
                <>
                  Page group {preview.pageGroup + 1} of {preview.pageGroups}
                  {loading && <Spinner className="ml-1.5 inline size-3 align-[-1px]" aria-label="Loading the call" />}
                </>
              }
              right={bytes(preview.bodyBytes)}
            />
            <div className="py-2">
              {head.map((line, index) => (
                <CodeLine key={`h${index}:${line.text}`} line={line} number={index + 1} gutter={requestGutter} flash={flashes(head, before?.head, index)} />
              ))}
              {shownBody.map((line, index) => (
                <CodeLine
                  key={`b${index}:${line.text}`}
                  line={line}
                  number={head.length + index + 1}
                  gutter={requestGutter}
                  flash={flashes(bodyLines, before?.body, index)}
                />
              ))}
              {bodyLines.length > FOLD_LINES && (
                <div className="flex min-h-5 items-center font-sans" style={{ paddingLeft: requestGutter }}>
                  <button
                    type="button"
                    onClick={() => setUnfolded(!unfolded)}
                    className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {folded ? `Show all ${bodyLines.length} lines` : `Fold to ${FOLD_LINES} lines`}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <BoxHeader left="Page group" right="" />
            <div className="flex flex-col gap-2 px-3 py-3" aria-label="Loading the call">
              {[45, 80, 60, 72, 55, 0, 30, 66, 50, 70, 40].map((width, index) =>
                width === 0 ? <div key={index} className="h-3" /> : <Skeleton key={index} className="h-3" style={{ width: `${width}%` }} />,
              )}
            </div>
          </>
        )}
        {answer && test.result && (
          <Fragment key={test.seq}>
            <BoxHeader className="border-t" left="Answer" right={test.result.status === null ? 'No answer' : duration(test.result.ms)} />
            <div className="py-2">
              {answer.slice(0, printed).map((line, index) => (
                <CodeLine key={`r${test.seq}:${index}`} line={line} number={index + 1} gutter={gutterWidth(answer.length)} />
              ))}
              {/* Room for the lines still to print, so the box does not jump. */}
              {printed < answer.length && <div aria-hidden style={{ height: (answer.length - printed) * 20 }} />}
            </div>
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
