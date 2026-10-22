'use client';

import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, FlaskConicalIcon, HistoryIcon, XCircleIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { ErrorNote } from '@/components/page';
import { StatusPill, type StatusTone } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { bytes, duration } from '@/lib/client/format';
import { shortUrl } from '@/lib/destination-config';
import type { DeliveryKind, DeliveryView } from '@/lib/types';

/** Deliveries shown at first and per Show more. */
const PAGE = 50;

/**
 * The words of the deliveries table for each kind: its title, the plural for Show more, its
 * empty text, where each went, and the verb of a delivery that went, such as "Sent".
 */
const KIND_TEXT: Record<DeliveryKind, { title: string; plural: string; none: string; to: string; noTarget: string; test: string; verb: string }> = {
  email: { title: 'Emails', plural: 'emails', none: 'This run sent no email.', to: 'To', noTarget: 'No address', test: 'Sent to the test address of the destination.', verb: 'Sent' },
  webhook: {
    title: 'Webhook calls',
    plural: 'calls',
    none: 'This run sent no webhook call.',
    to: 'Posted to',
    noTarget: 'No URL',
    test: 'Sent to the test URL of the destination.',
    verb: 'Sent',
  },
  sftp: {
    title: 'Uploads',
    plural: 'files',
    none: 'This run uploaded no file.',
    to: 'Uploaded to',
    noTarget: 'Not uploaded',
    test: 'Uploaded to the test folder of the destination.',
    verb: 'Uploaded',
  },
};

/** The path of an upload on the server, without the host: `sftp.example.com:/in/a.pdf` is `/in/a.pdf`. */
const remotePath = (to: string): string => {
  const at = to.indexOf(':/');
  return at >= 0 ? to.slice(at + 1) : to;
};

/** The receiver's answer to a webhook call and the tries, such as "200 OK in 142 ms, 3 tries", "No answer after 3 tries" or "Not tried". */
function answerText(delivery: DeliveryView): string {
  const { attempts } = delivery;
  if (attempts === 0) return 'Not tried';
  const tries = attempts === null ? null : attempts === 1 ? '1 try' : `${attempts} tries`;
  if (delivery.httpStatus === null) return tries ? `No answer after ${tries}` : 'No answer';
  const status = `${delivery.httpStatus} ${STATUS_TEXT[delivery.httpStatus] ?? ''}`.trim();
  const answer = delivery.ms === null ? status : `${status} in ${duration(delivery.ms)}`;
  return attempts !== null && attempts > 1 ? `${answer}, ${tries}` : answer;
}

/** The words of the HTTP statuses a receiver answers most. */
const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** How a delivery reads: Sent (or Uploaded), Test, Sent in run #N or Failed. */
function deliveryStatus(delivery: DeliveryView, text: { test: string; verb: string }): { tone: StatusTone; icon: typeof CheckCircle2Icon; label: string; title?: string } {
  if (delivery.status === 'failed') return { tone: 'message', icon: XCircleIcon, label: 'Failed' };
  if (delivery.status === 'already_sent') {
    const verb = text.verb.toLowerCase();
    return { tone: 'neutral', icon: HistoryIcon, label: `${text.verb} in run #${delivery.sentInRun}`, title: `An earlier run ${verb} it, so it was not ${verb} again.` };
  }
  if (delivery.test) return { tone: 'held', icon: FlaskConicalIcon, label: 'Test', title: text.test };
  return { tone: 'ready', icon: CheckCircle2Icon, label: text.verb };
}

/** Addresses that may break only after an @ or between addresses, never inside a word. */
function Addresses({ text }: { text: string }) {
  const parts = text.split('@');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              @<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

/** The other system's own text for a failed delivery: the mail server's, or the receiver's answer to a webhook call. */
function failedDetail(delivery: DeliveryView): string | undefined {
  const text = delivery.detail ?? delivery.response;
  if (!text) return undefined;
  return delivery.responseTruncated && text === delivery.response ? `${text}\n(The answer is longer; this is its first 2 KB.)` : text;
}

const time = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The deliveries of a run, such as its emails, webhook calls or uploads, one row per
 * document or file: what it was, where it went (for a webhook call the answer and the
 * tries, for an upload the path, the size and how long it took), the status and the time. A failed row opens to show what went wrong and the other system's own text. A
 * long list shows the first deliveries and says how many more there are.
 */
export function RunDeliveries({ kind, deliveries }: { kind: DeliveryKind; deliveries: DeliveryView[] }) {
  const text = KIND_TEXT[kind];
  const webhook = kind === 'webhook';
  const upload = kind === 'sftp';
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const sent = deliveries.filter((delivery) => delivery.status !== 'failed').length;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div>
      <h3 className="mb-2 font-medium text-sm">
        {text.title}{' '}
        {deliveries.length > 0 && (
          <span className="font-normal text-muted-foreground">
            ({sent} of {deliveries.length} {text.verb.toLowerCase()})
          </span>
        )}
      </h3>
      {deliveries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{text.none}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{upload ? 'File' : 'Document'}</th>
                <th className="w-px whitespace-nowrap px-3 py-2 font-medium">Status</th>
                <th className="hidden w-px whitespace-nowrap px-3 py-2 text-right font-medium sm:table-cell">Time</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.slice(0, shown).map((delivery) => {
                const status = deliveryStatus(delivery, text);
                const failed = delivery.status === 'failed';
                const expanded = open.has(delivery.id);
                return (
                  <Fragment key={delivery.id}>
                    <tr className="border-t align-top">
                      <td className="min-w-0 px-3 py-2">
                        {failed ? (
                          <button
                            type="button"
                            onClick={() => toggle(delivery.id)}
                            aria-expanded={expanded}
                            className="-ml-1 inline-flex items-start gap-0.5 rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {expanded ? <ChevronDownIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ChevronRightIcon className="mt-0.5 size-4 shrink-0" aria-hidden />}
                            <span className="break-words">{delivery.document}</span>
                          </button>
                        ) : (
                          <div className="break-words">{delivery.document}</div>
                        )}
                        <div className="text-muted-foreground text-xs">
                          {!delivery.to ? (
                            delivery.status === 'already_sent' && upload ? null : (
                              text.noTarget
                            )
                          ) : upload ? (
                            // Broken only after a slash, so a file name stays whole.
                            <span className="font-mono [overflow-wrap:anywhere]">
                              {remotePath(delivery.to)
                                .split('/')
                                .map((part, index, parts) => (
                                  <Fragment key={index}>
                                    {part}
                                    {index < parts.length - 1 && (
                                      <>
                                        /<wbr />
                                      </>
                                    )}
                                  </Fragment>
                                ))}
                            </span>
                          ) : webhook ? (
                            // Without the scheme, and broken only where one word does not fit.
                            <span className="break-words">
                              {text.to} {shortUrl(delivery.to)}
                            </span>
                          ) : (
                            <>
                              {text.to} <Addresses text={delivery.to} />
                            </>
                          )}
                        </div>
                        {webhook && delivery.status !== 'already_sent' && <div className="tabular text-muted-foreground text-xs">{answerText(delivery)}</div>}
                        {upload && delivery.status === 'sent' && (
                          <div className="tabular text-muted-foreground text-xs">
                            {[delivery.size !== null ? bytes(delivery.size) : null, delivery.ms !== null ? `in ${duration(delivery.ms)}` : null].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </td>
                      <td className="w-px whitespace-nowrap px-3 py-2">
                        <StatusPill tone={status.tone} icon={status.icon} title={status.title}>
                          {status.label}
                        </StatusPill>
                      </td>
                      <td className="tabular hidden w-px whitespace-nowrap px-3 py-2 text-right text-muted-foreground text-xs sm:table-cell">{time(delivery.sentAt)}</td>
                    </tr>
                    {failed && expanded && (
                      <tr>
                        {/* Any text breaks anywhere here, so the error and the answer wrap inside the table. */}
                        <td colSpan={3} className="px-3 pb-3 [&_*]:[overflow-wrap:anywhere]">
                          <ErrorNote detail={failedDetail(delivery)}>{delivery.error}</ErrorNote>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {deliveries.length > shown && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            Showing {shown} of {deliveries.length} {text.plural}.
          </span>
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, deliveries.length - shown)} more
          </Button>
        </div>
      )}
    </div>
  );
}
