'use client';

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DashboardRange, RunBucket } from '@/lib/types';

export const RANGES: { value: DashboardRange; label: string; text: string }[] = [
  { value: '24h', label: '24 h', text: 'per hour, last 24 hours' },
  { value: '7d', label: '7 d', text: 'per day, last 7 days' },
  { value: '30d', label: '30 d', text: 'per day, last 30 days' },
  { value: '90d', label: '90 d', text: 'per day, last 90 days' },
];

// Status colors: fixed, distinct from any series palette, and always named in the legend and tooltip.
const config = {
  success: { label: 'Succeeded', color: '#0ca30c' },
  warning: { label: 'Warnings', color: '#fab219' },
  failed: { label: 'Failed', color: '#d03b3b' },
  skipped: { label: 'Skipped', theme: { light: '#9a9a96', dark: '#6b6b67' } },
} satisfies ChartConfig;

const STATUSES = ['success', 'warning', 'failed', 'skipped'] as const;

/** A bucket's local start (`YYYY-MM-DDTHH:00`) as a Date in the browser's zone. */
const local = (at: string) => new Date(at);

/** Runs per hour or day, stacked by status, with the range to show. A click on a day opens it in the Job log. */
export function RunsChart({ series, range, onRange }: { series: RunBucket[] | null; range: DashboardRange; onRange: (range: DashboardRange) => void }) {
  const router = useRouter();
  const hourly = range === '24h';
  const tick = (at: string) =>
    hourly ? local(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : local(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const title = (at: string) =>
    hourly
      ? local(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : local(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const total = series?.reduce((sum, b) => sum + b.success + b.warning + b.failed + b.skipped, 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Runs</CardTitle>
        <CardDescription>{RANGES.find((r) => r.value === range)?.text}</CardDescription>
        <CardAction>
          <Tabs value={range} onValueChange={(value) => onRange(value as DashboardRange)}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r.value} value={r.value}>
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>
        {series === null ? (
          <Skeleton className="h-64 w-full" />
        ) : total === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-muted-foreground text-sm">No runs in this range.</div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart
              data={series}
              barCategoryGap={series.length > 30 ? 1 : '20%'}
              className="cursor-pointer"
              onClick={(state) => {
                const at = typeof state?.activeLabel === 'string' ? state.activeLabel : null;
                if (at) router.push(`/runs?from=${at.slice(0, 10)}&to=${at.slice(0, 10)}`);
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="at" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tick} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, payload) => title(String(payload?.[0]?.payload?.at ?? ''))} />} />
              {/* In stack order, bottom first, not by name. */}
              <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
              {STATUSES.map((status) => (
                <Bar key={status} dataKey={status} stackId="runs" fill={`var(--color-${status})`} stroke="var(--card)" strokeWidth={series.length > 30 ? 1 : 2} />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
