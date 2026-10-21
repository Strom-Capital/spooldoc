'use client';

import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, FlaskConicalIcon, HistoryIcon, XCircleIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { ErrorNote } from '@/components/page';
import { StatusPill, type StatusTone } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import type { DeliveryView } from '@/lib/types';

/** Emails shown at first and per Show more. */
const PAGE = 50;

/** How a delivery reads: Sent, Test, Sent in run #N or Failed. */
function deliveryStatus(delivery: DeliveryView): { tone: StatusTone; icon: typeof CheckCircle2Icon; label: string; title?: string } {
  if (delivery.status === 'failed') return { tone: 'message', icon: XCircleIcon, label: 'Failed' };
  if (delivery.status === 'already_sent') {
    return { tone: 'neutral', icon: HistoryIcon, label: `Sent in run #${delivery.sentInRun}`, title: 'An earlier run sent it, so it was not sent again.' };
  }
  if (delivery.test) return { tone: 'held', icon: FlaskConicalIcon, label: 'Test', title: 'Sent to the test address of the destination.' };
  return { tone: 'ready', icon: CheckCircle2Icon, label: 'Sent' };
}

const time = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The emails of a run, one row per document: the document, To, the status and the time. A
 * failed row opens to show what went wrong and the mail server's own text. A long list
 * shows the first emails and says how many more there are.
 */
export function RunEmails({ deliveries }: { deliveries: DeliveryView[] }) {
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
        Emails{' '}
        {deliveries.length > 0 && (
          <span className="font-normal text-muted-foreground">
            ({sent} of {deliveries.length} sent)
          </span>
        )}
      </h3>
      {deliveries.length === 0 ? (
        <p className="text-muted-foreground text-sm">This run sent no email.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Time</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.slice(0, shown).map((delivery) => {
                const status = deliveryStatus(delivery);
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
                        <div className="break-all text-muted-foreground text-xs">{delivery.to ? `To ${delivery.to}` : 'No address'}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <StatusPill tone={status.tone} icon={status.icon} title={status.title}>
                          {status.label}
                        </StatusPill>
                      </td>
                      <td className="tabular hidden whitespace-nowrap px-3 py-2 text-right text-muted-foreground text-xs sm:table-cell">{time(delivery.sentAt)}</td>
                    </tr>
                    {failed && expanded && (
                      <tr>
                        <td colSpan={3} className="px-3 pb-3">
                          <ErrorNote detail={delivery.detail ?? undefined}>{delivery.error}</ErrorNote>
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
            Showing {shown} of {deliveries.length} emails.
          </span>
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, deliveries.length - shown)} more
          </Button>
        </div>
      )}
    </div>
  );
}
