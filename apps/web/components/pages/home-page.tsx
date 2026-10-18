'use client';

import { ActivityIcon, InboxIcon, ServerIcon, WorkflowIcon } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { AttentionList } from '@/components/home/attention-list';
import { GettingStarted } from '@/components/home/getting-started';
import { KpiTile } from '@/components/home/kpi-tile';
import { RANGES, RunsChart } from '@/components/home/runs-chart';
import { ErrorNote, Page } from '@/components/page';
import { api, errorText } from '@/lib/client/api';
import type { AttentionItem, DashboardRange, DashboardView } from '@/lib/types';

const RANGE_KEY = 'spooldoc.home.range';

const subscribeNothing = () => () => undefined;

function savedRange(): DashboardRange {
  try {
    const value = localStorage.getItem(RANGE_KEY);
    return RANGES.some((r) => r.value === value) ? (value as DashboardRange) : '7d';
  } catch {
    return '7d';
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function queueDetail({ total, realtime, polled, unwatched }: DashboardView['outputQueues']): string {
  if (total === 0) return 'No job reads a queue yet';
  const parts = [`${realtime} real time`, `${polled} polled`];
  if (unwatched) parts.push(`${unwatched} on demand`);
  return parts.join(', ');
}

/** Setup progress while something is missing, then what is configured and how the runs went. */
export function HomePage() {
  // Null on the server and while hydrating, so the page does not load the default range first.
  const stored = useSyncExternalStore(subscribeNothing, savedRange, () => null);
  const [choice, setChoice] = useState<DashboardRange | null>(null);
  const saved = choice ?? stored;
  const range = saved ?? '7d';
  const [view, setView] = useState<{ range: DashboardRange; data: DashboardView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fetchView = () =>
      api<DashboardView>(`/api/dashboard?range=${saved}&tz=${encodeURIComponent(tz)}`).then(
        (data) => !cancelled && (setView({ range: saved, data }), setError(null)),
        (err) => !cancelled && setError(errorText(err)),
      );
    void fetchView();
    const timer = setInterval(() => void fetchView(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [saved, reloads]);

  /** Hide the items at once, then save; Undo in the toast brings them back. */
  async function dismiss(items: AttentionItem[]) {
    const gone = new Set(items.map((item) => item.id));
    setView((current) =>
      current && {
        ...current,
        data: {
          ...current.data,
          attention: {
            servers: current.data.attention.servers.filter((s) => !gone.has(s.id)),
            jobs: current.data.attention.jobs.filter((j) => !gone.has(j.id)),
            runs: current.data.attention.runs.filter((r) => !gone.has(r.id)),
          },
        },
      },
    );
    try {
      await api('/api/attention', { method: 'POST', body: { items } });
      toast.success(items.length === 1 ? 'Dismissed' : `Dismissed ${items.length} items`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void api('/api/attention', { method: 'POST', body: { items, dismissed: false } }).then(
              () => setReloads((n) => n + 1),
              (err) => toast.error('Could not undo', { description: errorText(err) }),
            ),
        },
      });
    } catch (err) {
      toast.error('Could not dismiss', { description: errorText(err) });
      setReloads((n) => n + 1);
    }
  }

  function chooseRange(next: DashboardRange) {
    setChoice(next);
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch {
      // Remembering the range is a convenience.
    }
  }

  const data = view?.data ?? null;
  const runs = view?.range === range ? data?.runs : undefined;
  const inRange = runs ? runs.success + runs.warning + runs.failed + runs.skipped : null;
  const finished = runs ? runs.success + runs.warning + runs.failed : 0;
  const rate = runs && finished > 0 ? `${Math.round(((runs.success + runs.warning) / finished) * 100)}% succeeded` : 'None finished';

  return (
    <Page title="Home" description="What is set up, and how the jobs have run.">
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      <div className="flex flex-col gap-4">
        {data && <GettingStarted setup={data.setup} />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Servers"
            icon={ServerIcon}
            href="/servers"
            value={data?.servers.total ?? null}
            detail={data ? (data.servers.failing ? plural(data.servers.failing, 'with an error', 'with errors') : data.servers.total ? 'All reachable' : 'None added yet') : ''}
          />
          <KpiTile
            label="Output queues"
            icon={InboxIcon}
            href="/queues"
            value={data?.outputQueues.total ?? null}
            detail={data ? queueDetail(data.outputQueues) : ''}
          />
          <KpiTile
            label="Jobs"
            icon={WorkflowIcon}
            href="/jobs"
            value={data?.jobs.total ?? null}
            detail={data ? `${data.jobs.watching} watching, ${data.jobs.paused} paused` : ''}
          />
          <KpiTile
            label={`Runs, last ${RANGES.find((r) => r.value === range)?.label}`}
            icon={ActivityIcon}
            href="/runs"
            value={inRange}
            detail={runs ? `${rate}, ${plural(runs.logged, 'run', 'runs')} in the log` : ''}
          />
        </div>
        <RunsChart series={view?.range === range ? view.data.series : null} range={range} onRange={chooseRange} />
        {data && <AttentionList attention={data.attention} onDismiss={(items) => void dismiss(items)} />}
      </div>
    </Page>
  );
}
