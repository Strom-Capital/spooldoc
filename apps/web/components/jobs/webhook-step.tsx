'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hint } from '@/components/hint';
import { CallPreview, type SendTestState } from '@/components/call-preview';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { api, ApiError, errorText, shownError } from '@/lib/client/api';
import { emptyWebhookSpec, FORMAT_FILES, FORMATS, type WebhookSpec } from '@/lib/job-spec';
import type { DestinationView, WebhookPreviewView, WebhookTestView } from '@/lib/types';
import { useJob } from './job-provider';

type WebhookDestination = Extract<DestinationView, { kind: 'webhook' }>;

/** How long the preview waits after a change before it asks again. */
const PREVIEW_DELAY_MS = 400;

/** The call of a page group, asked for again when the job changes (after a pause) or another page group is picked. */
function useWebhookPreview(webhook: WebhookSpec, destination: WebhookDestination, pageGroupIndex: number) {
  const { job, spec } = useJob();
  const { sampleId, yaml } = useWorkbench();
  const [state, setState] = useState<{ preview: WebhookPreviewView | null; previous: WebhookPreviewView | null; error: string | null; loading: boolean }>({
    preview: null,
    previous: null,
    error: null,
    loading: false,
  });
  // The definition, the templates and the destination's settings are part of the key, so the call follows a change to any of them.
  const body = useMemo(
    () =>
      JSON.stringify({
        request: { webhook, destinationId: destination.id, pageGroupIndex, sampleId: sampleId ?? undefined },
        yaml,
        templates: spec.render.templates,
        config: destination.config,
      }),
    [webhook, destination.id, destination.config, pageGroupIndex, sampleId, yaml, spec.render.templates],
  );
  const lastGroup = useRef(pageGroupIndex);
  useEffect(() => {
    if (!sampleId) return;
    let cancelled = false;
    // Stepping to another page group asks at once; other changes wait for a pause.
    const delay = lastGroup.current !== pageGroupIndex ? 0 : PREVIEW_DELAY_MS;
    lastGroup.current = pageGroupIndex;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      const { request } = JSON.parse(body) as { request: Record<string, unknown> };
      api<WebhookPreviewView>(`/api/jobs/${job.id}/webhook-preview`, { method: 'POST', body: request }).then(
        (preview) => !cancelled && setState((current) => ({ preview, previous: current.preview, error: null, loading: false })),
        (err: unknown) => !cancelled && setState((current) => ({ ...current, error: errorText(err), loading: false })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, job.id, pageGroupIndex, sampleId]);
  return state;
}

/**
 * The webhook part of the destination step: the formats of the files each call carries,
 * the page group to show, and the live call of that page group shown beside them, with
 * Send test.
 */
export function WebhookStep({ destination }: { destination: WebhookDestination }) {
  const { job, spec, updateDraft, readOnly } = useJob();
  const { pageGroupIndex, sampleId } = useWorkbench();
  const webhook = spec.destination.webhook ?? emptyWebhookSpec();
  const [pageGroup, setPageGroup] = useState(pageGroupIndex);
  const { preview, previous, loading, error } = useWebhookPreview(webhook, destination, pageGroup);
  const [test, setTest] = useState<SendTestState>({ sending: false, result: null, error: null, seq: 0 });

  const set = (change: Partial<WebhookSpec>) => updateDraft({ destination: { ...spec.destination, webhook: { ...webhook, ...change } } }, { debounce: false });
  const made = FORMATS.filter((format) => spec.render.templates.some((template) => template.formats.includes(format)));
  const sends = made.filter((format) => webhook.attach.includes(format));
  const shown = preview?.pageGroup ?? pageGroup;
  const total = preview?.pageGroups ?? null;

  async function sendTest() {
    setTest((current) => ({ ...current, sending: true, error: null }));
    const request = { webhook, destinationId: destination.id, pageGroupIndex: shown, sampleId: sampleId ?? undefined };
    try {
      const result = await api<WebhookTestView>(`/api/jobs/${job.id}/webhook-test`, { method: 'POST', body: request });
      setTest((current) => ({ sending: false, result, error: null, seq: current.seq + 1 }));
    } catch (err) {
      // A 502 is the receiver's answer, or no answer: it shows below the call.
      const body = err instanceof ApiError && err.status === 502 ? (err.body as WebhookTestView | undefined) : undefined;
      setTest((current) =>
        body && 'statusText' in body ? { sending: false, result: body, error: null, seq: current.seq + 1 } : { ...current, sending: false, error: shownError(err) },
      );
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-sm" id="webhook-files">
            Files to send
          </span>
          {made.length > 0 ? (
            <div role="group" aria-labelledby="webhook-files" className="flex flex-wrap gap-x-4 gap-y-2">
              {made.map((format) => (
                <div key={format} className="flex items-center gap-2">
                  <Checkbox
                    id={`webhook-attach-${format}`}
                    checked={webhook.attach.includes(format)}
                    disabled={readOnly}
                    onCheckedChange={(checked) => set({ attach: checked === true ? [...webhook.attach, format] : webhook.attach.filter((other) => other !== format) })}
                  />
                  <Label htmlFor={`webhook-attach-${format}`} className="font-normal">
                    {FORMAT_FILES[format].label}
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">The templates make no files yet.</p>
          )}
          <p className="text-muted-foreground text-xs">
            {sends.length === 0
              ? 'No files: each call holds the data only.'
              : "Each call carries its document's files in these formats, in base64. Leave out the ones the receiver does not need, to keep calls small."}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">Page group</span>
          <div className="flex items-center gap-1">
            <Hint text="Show the call of the page group before this one.">
              <Button type="button" variant="outline" size="icon-sm" disabled={shown === 0} onClick={() => setPageGroup(shown - 1)} aria-label="Previous page group">
                <ChevronLeftIcon />
              </Button>
            </Hint>
            <span className="tabular min-w-28 text-center text-sm" aria-live="polite">
              {total === null ? `Page group ${shown + 1}` : `${shown + 1} of ${total}`}
            </span>
            <Hint text="Show the call of the next page group.">
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
            Each document is one call. The receiver checks the signature with the destination&apos;s secret.{' '}
            <Link href="/docs/destinations#webhook" className="text-primary hover:underline">
              What each call holds
            </Link>
          </p>
        </div>
      </div>
      <div className="min-w-0 lg:sticky lg:top-0">
        <CallPreview
          preview={preview}
          previous={previous}
          loading={loading}
          error={error}
          hasSample={!!sampleId}
          test={test}
          onSendTest={sendTest}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
