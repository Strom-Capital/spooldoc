import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs } from '@/lib/server/db/schema';
import { jobSpecSchema } from '@/lib/job-spec';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params, spyConsole } from './helpers/mocks';

const createModel = vi.fn();
vi.mock('@/lib/server/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/models')>()),
  createModel: () => createModel(),
}));

const { POST } = await import('@/app/api/jobs/[id]/chat/route');
const { resetConfig } = await import('@/lib/server/config');
const { storeSample } = await import('@/lib/server/samples');

/** One part of a model stream, taken from the mock model's own types. */
type LanguageModelV4StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

const FAKE_KEY = 'sk-ant-fake-0123456789abcdef-do-not-leak';
const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const html = fixtureText('invoice', 'template.html');
let jobId: string;
let auth: Record<string, string>;

/** The job's draft as stored. */
async function draft() {
  const [row] = await db().select().from(jobs).where(eq(jobs.id, jobId));
  return jobSpecSchema.parse(row!.draft);
}

/** Put the definition into the job's draft. */
async function setDefinition(definition: string) {
  const current = await draft();
  await db().update(jobs).set({ draft: { ...current, extract: { definition } } }).where(eq(jobs.id, jobId));
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const toolStep = (toolName: string, input: unknown): LanguageModelV4StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
];

const textStep = (text: string): LanguageModelV4StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
];

/** A mock model that answers each step with the next list of stream parts. */
function scriptedModel(...steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: convertArrayToReadableStream(steps[step++] ?? textStep('done')) }),
  });
}

const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Propose a definition and a template for this sample' }] }];

const chat = (body: unknown = { messages }, headers?: Record<string, string>, id = jobId) =>
  POST(appRequest(`/api/jobs/${id}/chat`, { method: 'POST', body, headers: { ...auth, ...headers } }), params({ id }));

/** The UI message stream chunks of a response. */
async function chunks(response: Response): Promise<{ text: string; parts: Record<string, unknown>[] }> {
  const text = await response.text();
  const parts = text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return { text, parts };
}

let consoleSpies: ReturnType<typeof spyConsole>;

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  const serverId = await insertServer();
  const stored = await storeSample(serverId, { sample, warnings: [] });
  jobId = await insertJob(serverId);
  const current = await draft();
  await db().update(jobs).set({ draft: { ...current, preview: { sampleId: stored.id } } }).where(eq(jobs.id, jobId));
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  resetConfig();
  consoleSpies = spyConsole();
});

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  createModel.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  resetConfig();
});

describe('POST /api/jobs/[id]/chat', () => {
  it("runs write_definition from the model: writes the job's draft and streams the report", async () => {
    const model = scriptedModel(toolStep('write_definition', { yaml }), textStep('Saved the invoice definition.'));
    createModel.mockReturnValue(model);

    const response = await chat();
    const { text, parts } = await chunks(response);

    expect(response.status).toBe(200);
    expect((await draft()).extract.definition).toBe(yaml);
    const output = parts.find((p) => p.type === 'tool-output-available')?.output as { ok: boolean; documents: number; missing: string[] };
    expect(output).toMatchObject({ ok: true, type: 'invoice', documents: 6, missing: [] });
    expect(parts.some((p) => p.type === 'text-delta' && p.delta === 'Saved the invoice definition.')).toBe(true);
    expect(text).not.toContain(FAKE_KEY);

    // The instructions carry the masked pages and the tools; the second step sees the tool result.
    expect(model.doStreamCalls).toHaveLength(2);
    const instructions = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(instructions).toContain('Invoice no');
    expect(instructions).not.toContain('260101');
    expect(model.doStreamCalls[0]?.tools?.map((t) => t.name).sort()).toEqual([
      'read_sample_page',
      'render_preview',
      'write_definition',
      'write_template',
    ]);
  });

  it('runs write_template from the model and writes the template', async () => {
    await setDefinition(yaml);
    createModel.mockReturnValue(scriptedModel(toolStep('write_template', { html }), textStep('Template saved.')));

    const { parts } = await chunks(await chat());

    expect((await draft()).render.template).toBe(html);
    const output = parts.find((p) => p.type === 'tool-output-available')?.output as { ok: boolean; path: string; errors: string[] };
    expect(output).toMatchObject({ ok: true, path: 'template', errors: [] });
  });

  it('keeps the API key out of the stream when the provider fails', async () => {
    createModel.mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => {
          throw new Error(`401 invalid x-api-key ${FAKE_KEY}\n    at secret (/srv/app/node_modules/provider.js:1:1)`);
        },
      }),
    );

    const response = await chat();
    const { text, parts } = await chunks(response);

    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('provider.js');
    const error = parts.find((p) => p.type === 'error') as { errorText: string } | undefined;
    expect(error?.errorText).toMatch(/invalid x-api-key \*\*\*/);
  });

  it('answers 404 for a missing job, 400 for a bad body or no preview file, 401 signed out, 503 without a model and 403 across origins', async () => {
    createModel.mockReturnValue(scriptedModel());
    expect((await chat({ messages }, {}, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await chat({ messages: [] })).status).toBe(400);
    expect(
      (
        await POST(
          new Request(`http://localhost:3002/api/jobs/${jobId}/chat`, {
            method: 'POST',
            headers: { origin: 'http://localhost:3002', host: 'localhost:3002', ...auth },
            body: 'not json',
          }),
          params({ id: jobId }),
        )
      ).status,
    ).toBe(400);
    expect((await chat(undefined, { origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await POST(appRequest(`/api/jobs/${jobId}/chat`, { method: 'POST', body: { messages } }), params({ id: jobId }))).status).toBe(401);
    const current = await draft();
    await db().update(jobs).set({ draft: { ...current, preview: { sampleId: null } } }).where(eq(jobs.id, jobId));
    expect((await chat()).status).toBe(400);
    await db().update(jobs).set({ draft: current }).where(eq(jobs.id, jobId));

    createModel.mockReturnValue(null);
    const none = await chat();
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ error: 'No model configured' });
  });
});
