import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentUsage, jobs } from '@/lib/server/db/schema';
import { usageText } from '@/lib/client/format';
import type { AgentUsageView, UsageTotals } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { loadSample } from './helpers/fake-connection';
import { db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const createModel = vi.fn();
vi.mock('@/lib/server/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/models')>()),
  createModel: () => createModel(),
}));

const { monthKeys, stepUsage, usageMonths, usageTotals } = await import('@/lib/server/agent-usage');
const chatRoute = await import('@/app/api/jobs/[id]/chat/route');
const usageRoute = await import('@/app/api/jobs/[id]/chat/usage/route');
const settingsUsageRoute = await import('@/app/api/settings/agent-usage/route');
const { cleanUp } = await import('@/lib/server/retention');
const { storeSample } = await import('@/lib/server/samples');
const { setLogSink } = await import('@/lib/server/log');

type StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

/** The AI SDK's usage of a step, as `onStepEnd` gets it. */
const sdkUsage = (input: number, output: number, cached?: number, reasoning?: number) => ({
  inputTokens: input,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: cached, cacheWriteTokens: undefined },
  outputTokens: output,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: reasoning },
  totalTokens: input + output,
});

describe('stepUsage', () => {
  it('takes the tokens of an Anthropic step and no cost, even with metadata', () => {
    expect(stepUsage('anthropic', sdkUsage(1200, 300, 1000), { anthropic: { cacheCreationInputTokens: 0 } })).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 1000,
      reasoningTokens: null,
      costUsd: null,
    });
  });

  it('takes the cost OpenRouter reports in its usage metadata', () => {
    const metadata = { openrouter: { provider: 'Anthropic', usage: { promptTokens: 900, completionTokens: 40, totalTokens: 940, cost: 0.0123 } } };
    expect(stepUsage('openrouter', sdkUsage(900, 40, undefined, 12), metadata)).toEqual({
      inputTokens: 900,
      outputTokens: 40,
      cachedInputTokens: null,
      reasoningTokens: 12,
      costUsd: 0.0123,
    });
  });

  it('leaves the cost out when OpenRouter did not report one', () => {
    const metadata = { openrouter: { provider: 'Anthropic', usage: { promptTokens: 900, completionTokens: 40, totalTokens: 940 } } };
    expect(stepUsage('openrouter', sdkUsage(900, 40), metadata).costUsd).toBeNull();
  });

  it('reads the decimal string cost of the Vercel AI Gateway', () => {
    const metadata = { gateway: { cost: '0.0045405', marketCost: '0.0045405', generationId: 'gen_example' } };
    expect(stepUsage('gateway', sdkUsage(500, 50), metadata).costUsd).toBeCloseTo(0.0045405, 10);
  });

  it('takes no cost that is not a number of dollars', () => {
    expect(stepUsage('gateway', sdkUsage(1, 1), { gateway: { cost: 'free' } }).costUsd).toBeNull();
    expect(stepUsage('gateway', sdkUsage(1, 1), { gateway: { cost: '' } }).costUsd).toBeNull();
    expect(stepUsage('gateway', sdkUsage(1, 1), { gateway: { cost: -1 } }).costUsd).toBeNull();
    expect(stepUsage('openrouter', sdkUsage(1, 1), undefined).costUsd).toBeNull();
  });

  it("does not read another provider's cost, and gives a local model none", () => {
    expect(stepUsage('local', sdkUsage(10, 5), { gateway: { cost: '0.5' } }).costUsd).toBeNull();
    expect(stepUsage('openai', sdkUsage(10, 5), { openrouter: { usage: { cost: 0.5 } } }).costUsd).toBeNull();
  });

  it('keeps tokens the provider did not report as null, not 0', () => {
    expect(stepUsage('local', undefined, undefined)).toEqual({ inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, costUsd: null });
  });
});

describe('usageTotals', () => {
  const sums = { steps: 3, inputTokens: 30, outputTokens: 9, cachedInputTokens: 0, reasoningTokens: 0 };

  it('gives the cost when every step reported one', () => {
    expect(usageTotals({ ...sums, costUsd: 0.3, costSteps: 3 })).toMatchObject({ costUsd: 0.3, costPartial: false });
  });

  it('gives no total when only some steps reported a cost', () => {
    expect(usageTotals({ ...sums, costUsd: 0.2, costSteps: 2 })).toMatchObject({ costUsd: null, costPartial: true });
  });

  it('gives no cost when no step reported one', () => {
    expect(usageTotals({ ...sums, costUsd: null, costSteps: 0 })).toMatchObject({ costUsd: null, costPartial: false });
  });
});

describe('monthKeys', () => {
  it('gives the month in the time zone, and the one before across a year', () => {
    expect(monthKeys(new Date('2026-01-15T12:00:00Z'), 'UTC')).toEqual({ thisMonth: '2026-01', lastMonth: '2025-12' });
    // 23:30 UTC on 31 October is already November in Helsinki.
    expect(monthKeys(new Date('2026-10-31T23:30:00Z'), 'Europe/Helsinki')).toEqual({ thisMonth: '2026-11', lastMonth: '2026-10' });
  });
});

describe('usageMonths', () => {
  const row = (month: string, model: string, inputTokens: number) => ({
    month,
    provider: 'openrouter',
    model,
    steps: 1,
    inputTokens,
    outputTokens: 1,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.01,
    costSteps: 1,
  });

  it('splits rows into this month and last month, the most used model first, and leaves older months out', () => {
    const view = usageMonths([row('2026-10', 'small', 10), row('2026-10', 'large', 1000), row('2026-09', 'small', 5), row('2026-08', 'old', 5)], new Date('2026-10-20T12:00:00Z'), 'UTC');
    expect(view.thisMonth.month).toBe('2026-10');
    expect(view.thisMonth.lines.map((line) => line.model)).toEqual(['large', 'small']);
    expect(view.lastMonth).toMatchObject({ month: '2026-09', lines: [{ model: 'small', costUsd: 0.01 }] });
  });
});

describe('usageText', () => {
  const totals: UsageTotals = { steps: 4, inputTokens: 1_234_000, outputTokens: 84_000, cachedInputTokens: 0, reasoningTokens: 0, costUsd: 0.42, costPartial: false };

  it('reads tokens in and out, and the cost', () => {
    expect(usageText(totals)).toBe('1.2M tokens in, 84K out, $0.42');
  });

  it('shows cached and reasoning tokens only when there are some', () => {
    expect(usageText({ ...totals, cachedInputTokens: 800_000, reasoningTokens: 12_000, costUsd: null })).toBe('1.2M tokens in (800K cached), 84K out (12K reasoning)');
  });

  it('says when the cost is known for only some steps, and shows a cost below a cent', () => {
    expect(usageText({ ...totals, costUsd: null, costPartial: true })).toBe('1.2M tokens in, 84K out, cost not reported for every step');
    expect(usageText({ ...totals, costUsd: 0.0031 })).toBe('1.2M tokens in, 84K out, $0.0031');
  });
});

describe('agent usage in the database', () => {
  const sample = loadSample('invoice');
  let auth: Record<string, string>;
  let jobId: string;

  const finish = (input: number, output: number, providerMetadata?: Extract<StreamPart, { type: 'finish' }>['providerMetadata']): StreamPart => ({
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage: { inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } },
    ...(providerMetadata ? { providerMetadata } : {}),
  });

  const textStep = (text: string, end: StreamPart): StreamPart[] => [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    end,
  ];

  const toolStep = (end: StreamPart): StreamPart[] => [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_sample_page', input: JSON.stringify({ page: 1 }) },
    { ...end, finishReason: { unified: 'tool-calls', raw: 'tool_use' } } as StreamPart,
  ];

  function model(...steps: StreamPart[][]): MockLanguageModelV4 {
    let step = 0;
    return new MockLanguageModelV4({ doStream: async () => ({ stream: convertArrayToReadableStream(steps[step++] ?? steps.at(-1)!) }) });
  }

  const use = (m: MockLanguageModelV4, provider = 'local', id = 'mock') => createModel.mockResolvedValue({ model: m, info: { provider, id }, reasoning: 'provider-default', secrets: [] });

  async function chat(): Promise<void> {
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Propose a definition' }] }];
    const response = await chatRoute.POST(appRequest(`/api/jobs/${jobId}/chat`, { method: 'POST', body: { messages }, headers: auth }), params({ id: jobId }));
    expect(response.status).toBe(200);
    await response.text();
  }

  async function thisChat(): Promise<UsageTotals> {
    const response = await usageRoute.GET(appRequest(`/api/jobs/${jobId}/chat/usage`, { headers: auth }), params({ id: jobId }));
    expect(response.status).toBe(200);
    return response.json();
  }

  async function months(tz: string): Promise<AgentUsageView> {
    const response = await settingsUsageRoute.GET(appRequest(`/api/settings/agent-usage?tz=${encodeURIComponent(tz)}`, { headers: auth }));
    expect(response.status).toBe(200);
    return response.json();
  }

  beforeEach(async () => {
    await resetTables(db());
    auth = await signedIn();
    const serverId = await insertServer();
    const stored = await storeSample(serverId, { sample, warnings: [] });
    jobId = await insertJob(serverId);
    const [row] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    await db().update(jobs).set({ draft: { ...row!.draft, preview: { sampleId: stored.id } } }).where(eq(jobs.id, jobId));
  });

  afterEach(() => {
    setLogSink(null);
    process.env.SPOOLDOC_LOG_LEVEL = 'off';
    createModel.mockReset();
  });

  it('records one row per model step, with the cost OpenRouter reports', async () => {
    const cost = (value: number) => ({ openrouter: { provider: 'Anthropic', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: value } } });
    use(model(toolStep(finish(100, 10, cost(0.01))), textStep('Done.', finish(150, 20, cost(0.02)))), 'openrouter', 'anthropic/claude-sonnet-5.5');

    await chat();

    const rows = await db().select().from(agentUsage);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.provider, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.jobId])).toEqual(
      expect.arrayContaining([
        ['openrouter', 'anthropic/claude-sonnet-5.5', 100, 10, 0.01, jobId],
        ['openrouter', 'anthropic/claude-sonnet-5.5', 150, 20, 0.02, jobId],
      ]),
    );
    expect(rows.every((row) => row.userId !== null)).toBe(true);
    const totals = await thisChat();
    expect(totals).toMatchObject({ steps: 2, inputTokens: 250, outputTokens: 30, costPartial: false });
    expect(totals.costUsd).toBeCloseTo(0.03, 10);
  });

  it('gives a local model tokens and no cost', async () => {
    use(model(textStep('Done.', finish(40, 4))));
    await chat();
    expect(await thisChat()).toMatchObject({ steps: 1, inputTokens: 40, outputTokens: 4, costUsd: null, costPartial: false });
  });

  it("counts this chat from the thread's start: not the steps before New chat", async () => {
    use(model(textStep('First.', finish(40, 4))));
    await chat();
    expect((await thisChat()).steps).toBe(1);

    const cleared = await chatRoute.DELETE(appRequest(`/api/jobs/${jobId}/chat`, { method: 'DELETE', headers: auth }), params({ id: jobId }));
    expect(cleared.status).toBe(204);
    expect(await thisChat()).toMatchObject({ steps: 0, inputTokens: 0, costUsd: null });

    use(model(textStep('Second.', finish(7, 1))));
    await chat();
    expect(await thisChat()).toMatchObject({ steps: 1, inputTokens: 7, outputTokens: 1 });
    expect(await db().select().from(agentUsage)).toHaveLength(2);
  });

  it('keeps the steps of a turn that fails part way', async () => {
    let step = 0;
    use(
      new MockLanguageModelV4({
        doStream: async () => {
          if (step++ > 0) throw new Error('The provider is down');
          return { stream: convertArrayToReadableStream(toolStep(finish(30, 3))) };
        },
      }),
    );
    await chat();
    expect(await thisChat()).toMatchObject({ steps: 1, inputTokens: 30, outputTokens: 3 });
  });

  it('logs a count that cannot be stored and still answers', async () => {
    const lines: { level: string; msg: string }[] = [];
    process.env.SPOOLDOC_LOG_LEVEL = 'info';
    setLogSink((line) => lines.push(JSON.parse(line)));
    // More tokens than the column holds: the insert fails.
    use(model(textStep('Still answered.', finish(3_000_000_000, 1))));

    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Propose a definition' }] }];
    const response = await chatRoute.POST(appRequest(`/api/jobs/${jobId}/chat`, { method: 'POST', body: { messages }, headers: auth }), params({ id: jobId }));
    expect(await response.text()).toContain('Still answered.');

    expect(await db().select().from(agentUsage)).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', msg: 'Could not record the agent usage', jobId }));
  });

  it('sums this month and last month per provider and model in the viewer time zone, and keeps usage of a deleted job', async () => {
    const now = new Date();
    const { thisMonth, lastMonth } = monthKeys(now, 'Europe/Helsinki');
    const [year, month] = thisMonth.split('-').map(Number) as [number, number];
    // The 15th, noon UTC, is inside each month in any time zone.
    const day = (monthsBack: number) => new Date(Date.UTC(year, month - 1 - monthsBack, 15, 12));
    const step = (createdAt: Date, provider: string, model: string, costUsd: number | null) => ({
      createdAt,
      jobId,
      provider,
      model,
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: 50,
      reasoningTokens: null,
      costUsd,
    });
    await db()
      .insert(agentUsage)
      .values([
        step(day(0), 'gateway', 'anthropic/claude-sonnet-5.5', 0.01),
        step(day(0), 'gateway', 'anthropic/claude-sonnet-5.5', 0.02),
        step(day(0), 'anthropic', 'claude-haiku-5-5', null),
        step(day(1), 'openrouter', 'openai/gpt-6.1-sol', 0.05),
        step(day(1), 'openrouter', 'openai/gpt-6.1-sol', null),
        step(day(2), 'anthropic', 'claude-opus-5-5', null),
      ]);
    await db().delete(jobs).where(eq(jobs.id, jobId));

    const view = await months('Europe/Helsinki');

    expect(view.thisMonth.month).toBe(thisMonth);
    expect(view.thisMonth.lines).toHaveLength(2);
    const gateway = view.thisMonth.lines.find((line) => line.provider === 'gateway')!;
    expect(gateway).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', steps: 2, inputTokens: 200, outputTokens: 20, cachedInputTokens: 100, reasoningTokens: 0, costPartial: false });
    expect(gateway.costUsd).toBeCloseTo(0.03, 10);
    expect(view.thisMonth.lines.find((line) => line.provider === 'anthropic')).toMatchObject({ costUsd: null, costPartial: false });
    expect(view.lastMonth).toMatchObject({ month: lastMonth, lines: [{ provider: 'openrouter', steps: 2, costUsd: null, costPartial: true }] });
  });

  it('is empty before the agent was used, and an unknown time zone is UTC', async () => {
    const view = await months('Not/AZone');
    expect(view.thisMonth.lines).toEqual([]);
    expect(view.lastMonth.lines).toEqual([]);
    expect(view.thisMonth.month).toBe(monthKeys(new Date(), 'UTC').thisMonth);
  });

  it('is deleted with the retention', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const values = (createdAt: Date) => ({ createdAt, jobId, provider: 'local', model: 'mock', inputTokens: 1, outputTokens: 1 });
    await db()
      .insert(agentUsage)
      .values([values(new Date('2026-08-01T00:00:00Z')), values(new Date('2026-10-17T00:00:00Z'))]);

    expect(await cleanUp(30, now)).toMatchObject({ agentUsage: 1 });
    expect((await db().select().from(agentUsage)).map((row) => row.createdAt.toISOString())).toEqual(['2026-10-17T00:00:00.000Z']);
  });
});
