import 'server-only';

import type { LanguageModelUsage, ProviderMetadata } from 'ai';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { AiProviderId } from '../ai-providers';
import type { AgentUsageView, UsageLine, UsageTotals } from '../types';
import { getDb } from './db';
import { agentUsage, jobChats } from './db/schema';

/**
 * What the agent used: one row per model step, so a turn that is stopped or fails part
 * way still counts the steps that finished. Tokens come from the AI SDK's usage, which
 * every provider fills. A cost is kept only when the provider reported one (OpenRouter
 * and the Vercel AI Gateway); there is no price table, so for the others only tokens
 * are known.
 */

/** The tokens and cost of one model step. Null where the provider did not report it. */
export interface StepUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);

/** A cost the provider reported, as a number of dollars: a number, or a decimal string. */
function dollars(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/**
 * The cost a provider reported for a step, in US dollars, or null.
 *
 * - OpenRouter: `providerMetadata.openrouter.usage.cost`, a number (its usage accounting).
 * - Vercel AI Gateway: `providerMetadata.gateway.cost`, a decimal string.
 *
 * The other providers report no cost.
 */
export function reportedCost(provider: AiProviderId, metadata: ProviderMetadata | undefined): number | null {
  if (provider === 'openrouter') return dollars(record(record(metadata?.openrouter)?.usage)?.cost);
  if (provider === 'gateway') return dollars(record(metadata?.gateway)?.cost);
  return null;
}

/**
 * The tokens and cost of a finished step, from the AI SDK's usage and the provider's metadata.
 *
 * @param provider - The provider the step ran on
 * @param usage - The step's usage
 * @param metadata - The step's provider metadata
 */
export function stepUsage(provider: AiProviderId, usage: LanguageModelUsage | undefined, metadata: ProviderMetadata | undefined): StepUsage {
  return {
    inputTokens: count(usage?.inputTokens),
    outputTokens: count(usage?.outputTokens),
    cachedInputTokens: count(usage?.inputTokenDetails?.cacheReadTokens),
    reasoningTokens: count(usage?.outputTokenDetails?.reasoningTokens),
    costUsd: reportedCost(provider, metadata),
  };
}

/** Store one step's usage. */
export async function recordUsage(entry: StepUsage & { jobId: string | null; userId: string | null; provider: AiProviderId; model: string }): Promise<void> {
  await getDb().insert(agentUsage).values(entry);
}

/** Sums over some usage rows, as the database adds them up. */
export interface UsageSums {
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  /** The sum of the costs that were reported. */
  costUsd: number | null;
  /** How many steps reported a cost. */
  costSteps: number;
}

/**
 * The totals to show. The cost is given only when every step reported one: a sum of
 * some steps' costs would look like the whole cost and be too low.
 */
export function usageTotals(sums: UsageSums): UsageTotals {
  const allCosted = sums.steps > 0 && sums.costSteps === sums.steps;
  return {
    steps: sums.steps,
    inputTokens: sums.inputTokens,
    outputTokens: sums.outputTokens,
    cachedInputTokens: sums.cachedInputTokens,
    reasoningTokens: sums.reasoningTokens,
    costUsd: allCosted ? (sums.costUsd ?? 0) : null,
    costPartial: sums.costSteps > 0 && !allCosted,
  };
}

/** The month of an instant in a time zone, and the month before it, as `YYYY-MM`. */
export function monthKeys(now: Date, timeZone: string): { thisMonth: string; lastMonth: string } {
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now);
  const [year, month] = thisMonth.split('-').map(Number) as [number, number];
  const lastMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  return { thisMonth, lastMonth };
}

/** Rows of usage sums per month, provider and model. */
export type MonthRow = UsageSums & { month: string; provider: string; model: string };

/**
 * This month's and last month's usage, one line per provider and model, the most input
 * tokens first. Rows of other months are left out.
 */
export function usageMonths(rows: MonthRow[], now: Date, timeZone: string): AgentUsageView {
  const keys = monthKeys(now, timeZone);
  const lines = (month: string): UsageLine[] =>
    rows
      .filter((row) => row.month === month)
      .map((row) => ({ provider: row.provider, model: row.model, ...usageTotals(row) }))
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || a.model.localeCompare(b.model));
  return { thisMonth: { month: keys.thisMonth, lines: lines(keys.thisMonth) }, lastMonth: { month: keys.lastMonth, lines: lines(keys.lastMonth) } };
}

const sums = {
  steps: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${agentUsage.inputTokens}), 0)::float8`,
  outputTokens: sql<number>`coalesce(sum(${agentUsage.outputTokens}), 0)::float8`,
  cachedInputTokens: sql<number>`coalesce(sum(${agentUsage.cachedInputTokens}), 0)::float8`,
  reasoningTokens: sql<number>`coalesce(sum(${agentUsage.reasoningTokens}), 0)::float8`,
  costUsd: sql<number | null>`sum(${agentUsage.costUsd})::float8`,
  costSteps: sql<number>`count(${agentUsage.costUsd})::int`,
};

/**
 * The agent's usage this month and last month, in calendar months of the viewer's time zone.
 *
 * @param timeZone - A known time zone name (see `safeZone`)
 * @param now - The current time
 */
export async function agentUsageView(timeZone: string, now: Date = new Date()): Promise<AgentUsageView> {
  const local = sql`(${agentUsage.createdAt} at time zone ${timeZone})`;
  const month = sql<string>`to_char(date_trunc('month', ${local}), 'YYYY-MM')`;
  const since = sql`((date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${timeZone}) - interval '1 month') at time zone ${timeZone})`;
  const rows = await getDb()
    .select({ month, provider: agentUsage.provider, model: agentUsage.model, ...sums })
    .from(agentUsage)
    .where(gte(agentUsage.createdAt, since))
    // By position: the time zone is a parameter, so the month expression in GROUP BY would not match the one in SELECT.
    .groupBy(sql`1`, sql`2`, sql`3`);
  return usageMonths(rows, now, timeZone);
}

/**
 * The usage of the job's current agent thread. New chat deletes the thread and the
 * first message of a new one makes it again (`startChat`), so the thread's `created_at`
 * is when this chat began: the steps of the job recorded from then are this chat's.
 * Without a thread, nothing is counted.
 */
export async function chatUsage(jobId: string): Promise<UsageTotals> {
  const [row] = await getDb()
    .select(sums)
    .from(agentUsage)
    .innerJoin(jobChats, eq(jobChats.jobId, agentUsage.jobId))
    .where(and(eq(agentUsage.jobId, jobId), gte(agentUsage.createdAt, jobChats.createdAt)));
  return usageTotals(row ?? { steps: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, costUsd: null, costSteps: 0 });
}
