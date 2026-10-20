import type { UIMessage } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobChats, jobs, jobVersions, settings, templateFiles } from '@/lib/server/db/schema';
import { jobSpecSchema, versionSpec } from '@/lib/job-spec';
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

const { GET, POST, DELETE } = await import('@/app/api/jobs/[id]/chat/route');
const { setDocumentRenderer } = await import('@/lib/server/documents');
const { fakeRenderer, PDF_BYTES } = await import('./helpers/carbone');
const { storeSample } = await import('@/lib/server/samples');

/** One part of a model stream, taken from the mock model's own types. */
type LanguageModelV4StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

const FAKE_KEY = 'sk-ant-fake-0123456789abcdef-do-not-leak';

/** What `createModel` returns: the model, which one it is, the effort from Settings and the key to redact. */
const withKey = (model: MockLanguageModelV4, reasoning = 'provider-default') => ({ model, info: { provider: 'local', id: 'mock' }, reasoning, secrets: [FAKE_KEY] });
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

/** The stored thread, as the panel loads it. */
async function storedThread(id = jobId): Promise<UIMessage[]> {
  const response = await GET(appRequest(`/api/jobs/${id}/chat`, { headers: auth }), params({ id }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { messages: UIMessage[] }).messages;
}

const clear = (headers: Record<string, string> = auth, id = jobId) =>
  DELETE(appRequest(`/api/jobs/${id}/chat`, { method: 'DELETE', headers }), params({ id }));

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
  consoleSpies = spyConsole();
});

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  createModel.mockReset();
});

describe('POST /api/jobs/[id]/chat', () => {
  it("runs write_definition from the model: writes the job's draft and streams the report", async () => {
    const model = scriptedModel(toolStep('write_definition', { yaml }), textStep('Saved the invoice definition.'));
    createModel.mockResolvedValue(withKey(model, 'high'));

    const response = await chat();
    const { text, parts } = await chunks(response);

    expect(response.status).toBe(200);
    expect((await draft()).extract.definition).toBe(yaml);
    const output = parts.find((p) => p.type === 'tool-output-available')?.output as { ok: boolean; pageGroups: number; missing: string[] };
    expect(output).toMatchObject({ ok: true, type: 'invoice', pageGroups: 6, missing: [] });
    expect(parts.some((p) => p.type === 'text-delta' && p.delta === 'Saved the invoice definition.')).toBe(true);
    expect(text).not.toContain(FAKE_KEY);

    // The instructions carry the pages, values as printed with masking off, and the tools; the second step sees the tool result.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.reasoning).toBe('high');
    const instructions = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(instructions).toContain('Invoice no');
    expect(instructions).toContain('260101');
    expect(model.doStreamCalls[0]?.tools?.map((t) => t.name).sort()).toEqual([
      'add_template',
      'ask_user',
      'edit_excel_template',
      'edit_word_template',
      'list_jobs',
      'read_carbone_reference',
      'read_excel_template',
      'read_job_files',
      'read_sample_page',
      'read_word_template',
      'remove_template',
      'render_preview',
      'write_definition',
      'write_excel_template',
      'write_template',
      'write_word_template',
    ]);
  });

  it('ends the turn when the model asks the user a question with ask_user', async () => {
    const question = { question: 'Both make PDF. For this invoice I recommend HTML.', options: [{ label: 'HTML', recommended: true }, { label: 'Word' }] };
    const model = scriptedModel(toolStep('ask_user', question), textStep('This step must not run.'));
    createModel.mockResolvedValue(withKey(model));

    const { parts } = await chunks(await chat());

    expect(model.doStreamCalls).toHaveLength(1);
    expect(parts.find((p) => p.type === 'tool-output-available')?.output).toEqual({ ok: true, asked: true });
    expect(parts.some((p) => p.type === 'text-delta')).toBe(false);
  });

  it('lets the model try again when ask_user turns its question down', async () => {
    const wrong = { question: 'Which kind of template?', options: [{ label: 'Word' }, { label: 'HTML', recommended: true }] };
    const model = scriptedModel(toolStep('ask_user', wrong), textStep('Asked again.'));
    createModel.mockResolvedValue(withKey(model));

    const { parts } = await chunks(await chat());

    expect(model.doStreamCalls).toHaveLength(2);
    expect(parts.find((p) => p.type === 'tool-output-available')?.output).toEqual({
      ok: false,
      error: 'Only the first answer can be recommended. Put the one you recommend first.',
    });
    expect(parts.some((p) => p.type === 'text-delta' && p.delta === 'Asked again.')).toBe(true);
  });

  it('runs write_template from the model and writes the template', async () => {
    await setDefinition(yaml);
    createModel.mockResolvedValue(withKey(scriptedModel(toolStep('write_template', { html }), textStep('Template saved.'))));

    const { parts } = await chunks(await chat());

    expect((await draft()).render.templates[0]).toMatchObject({ kind: 'html', source: html });
    const output = parts.find((p) => p.type === 'tool-output-available')?.output as { ok: boolean; path: string; errors: string[] };
    expect(output).toMatchObject({ ok: true, path: 'template', template: 'Template 1', templateId: 'template-1', errors: [] });
  });

  it('designs and edits a Word template as new files, and shows the model the PDF once', async () => {
    await setDefinition(yaml);
    setDocumentRenderer(fakeRenderer);
    const design = { sections: [{ children: [{ type: 'Paragraph', text: 'Invoice {d.pg.invoiceNo}' }] }] };
    const model = scriptedModel(
      toolStep('write_word_template', { design, name: 'invoice.docx' }),
      toolStep('edit_word_template', { edits: [{ part: 'word/document.xml', find: '>Invoice ', replace: '>Sales invoice ' }] }),
      textStep('Done.'),
    );
    createModel.mockResolvedValue({ ...withKey(model), info: { provider: 'anthropic', id: 'claude-mock' } });
    try {
      await chunks(await chat());
    } finally {
      setDocumentRenderer(null);
    }

    const files = await db().select().from(templateFiles).orderBy(templateFiles.createdAt);
    expect(files).toHaveLength(2);
    const [first, second] = files;
    expect(first).toMatchObject({ name: 'invoice.docx', madeBy: 'assistant', previousId: null, createdBy: expect.any(String) });
    expect(second).toMatchObject({ name: 'invoice.docx', madeBy: 'assistant', previousId: first!.id });
    expect((await draft()).render.templates[0]).toMatchObject({ kind: 'docx', fileId: second!.id, formats: ['pdf'] });

    // The step after each call has the PDF; the stored thread has the results' text only.
    const toolResult = (call: number) =>
      (model.doStreamCalls[call]!.prompt.at(-1) as { content: { output: { type: string; value: { type: string; mediaType?: string }[] } }[] }).content[0]!.output;
    expect(toolResult(1).type).toBe('content');
    expect(toolResult(1).value[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
    expect(toolResult(2).value[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
    const thread = JSON.stringify(await storedThread());
    expect(thread).toContain('"view":"pdf"');
    expect(thread).not.toContain(Buffer.from(PDF_BYTES).toString('base64'));
  });

  it('adds a template and writes it through the draft store', async () => {
    await setDefinition(yaml);
    createModel.mockResolvedValue(
      withKey(
        scriptedModel(
          toolStep('add_template', { name: 'Lines', formats: ['html'] }),
          toolStep('write_template', { html: '<p>{d.pg.invoiceNo}</p>', template: 'Lines' }),
          toolStep('remove_template', { template: 'Template 1' }),
          textStep('Done.'),
        ),
      ),
    );
    await chunks(await chat());

    expect((await draft()).render.templates).toEqual([
      { id: 'lines', name: 'Lines', kind: 'html', source: '<p>{d.pg.invoiceNo}</p>', formats: ['html'] },
    ]);
  });

  it('designs and edits an Excel template as new files, and shows the model the PDF once', async () => {
    await setDefinition(yaml);
    setDocumentRenderer(fakeRenderer);
    const design = {
      sheets: [
        {
          name: 'Lines',
          cells: [
            { ref: 'A1', value: 'Invoice' },
            { ref: 'A2', value: '{d.pgs[i].invoiceNo}' },
            { ref: 'A3', value: '{d.pgs[i+1].lines[i+1]}' },
          ],
        },
      ],
    };
    const model = scriptedModel(
      toolStep('write_excel_template', { design, name: 'lines.xlsx' }),
      toolStep('edit_excel_template', { edits: [{ part: 'xl/worksheets/sheet1.xml', find: '>Invoice<', replace: '>Invoice number<' }] }),
      textStep('Done.'),
    );
    createModel.mockResolvedValue({ ...withKey(model), info: { provider: 'anthropic', id: 'claude-mock' } });
    try {
      await chunks(await chat());
    } finally {
      setDocumentRenderer(null);
    }

    const files = await db().select().from(templateFiles).orderBy(templateFiles.createdAt);
    expect(files).toHaveLength(2);
    const [first, second] = files;
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(first).toMatchObject({ name: 'lines.xlsx', contentType: XLSX, madeBy: 'assistant', previousId: null, createdBy: expect.any(String) });
    expect(second).toMatchObject({ name: 'lines.xlsx', contentType: XLSX, madeBy: 'assistant', previousId: first!.id });
    expect((await draft()).render.templates[0]).toMatchObject({ kind: 'xlsx', fileId: second!.id, scope: 'splf', formats: ['xlsx'] });

    // The step after each call has the PDF; the stored thread has the results' text only.
    const toolResult = (call: number) =>
      (model.doStreamCalls[call]!.prompt.at(-1) as { content: { output: { type: string; value: { type: string; mediaType?: string; text?: string }[] } }[] }).content[0]!.output;
    expect(toolResult(1).value[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
    expect(toolResult(2).value[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
    expect(JSON.parse(toolResult(2).value[0]!.text!).textPreview).toContain('Lines!A1: "Invoice number"');
    const thread = JSON.stringify(await storedThread());
    expect(thread).toContain('"view":"pdf"');
    expect(thread).toContain('"errorCells":0');
    expect(thread).not.toContain(Buffer.from(PDF_BYTES).toString('base64'));
  });

  it("shows the model an Excel template's cells, adds one and keeps the Word tools off it", async () => {
    await setDefinition(yaml);
    setDocumentRenderer(fakeRenderer);
    const { parseDefinition, starterXlsx } = await import('@spooldoc/core');
    const content = Buffer.from(await starterXlsx(parseDefinition(yaml)));
    const [file] = await db().insert(templateFiles).values({ name: 'lines.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: content.length, content }).returning();
    const current = await draft();
    const templates = [{ id: 'lines', name: 'Lines', kind: 'xlsx' as const, fileId: file!.id, scope: 'splf' as const, formats: ['xlsx' as const] }];
    await db().update(jobs).set({ draft: { ...current, render: { templates } } }).where(eq(jobs.id, jobId));
    const model = scriptedModel(
      toolStep('write_word_template', { design: { sections: [{ children: [] }] }, template: 'Lines' }),
      toolStep('add_template', { name: 'Per invoice', kind: 'xlsx', scope: 'pageGroup' }),
      textStep('Done.'),
    );
    createModel.mockResolvedValue(withKey(model));
    try {
      const { parts } = await chunks(await chat());
      const outputs = parts.filter((p) => p.type === 'tool-output-available').map((p) => p.output as Record<string, unknown>);
      expect(outputs[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^The Lines template is an Excel template with a file of its own: change it with edit_excel_template/) });
      expect(outputs[1]).toMatchObject({ ok: true, template: { name: 'Per invoice', kind: 'xlsx', scope: 'pageGroup', formats: ['xlsx'] } });
    } finally {
      setDocumentRenderer(null);
    }
    const system = JSON.stringify(model.doStreamCalls[0]!.prompt[0]);
    expect(system).toContain('An Excel template file, `lines.xlsx`. Each file holds the whole spooled file');
    expect(system).toContain('Lines!A2: {d.pgs[i].invoiceNo}');
    expect((await draft()).render.templates).toEqual([templates[0], { id: 'per-invoice', name: 'Per invoice', kind: 'xlsx', fileId: null, scope: 'pageGroup', formats: ['xlsx'] }]);
    expect(await db().select({ id: templateFiles.id }).from(templateFiles)).toHaveLength(1);
  });

  it("reads another job's active version through read_job_files, never the job itself", async () => {
    const serverId = (await draft()).source.serverId!;
    const otherId = await insertJob(serverId, {
      extract: { definition: yaml },
      render: { templates: [{ id: 'main', name: 'Document', kind: 'html', source: html, formats: ['pdf'] }] },
    });
    const [other] = await db().select().from(jobs).where(eq(jobs.id, otherId));
    await db().insert(jobVersions).values({ jobId: otherId, number: 1, spec: versionSpec(jobSpecSchema.parse(other!.draft)) });
    // The draft changes after the version: the tools read the version, not the draft.
    const changed = { ...jobSpecSchema.parse(other!.draft), extract: { definition: 'type: draft-only\nversion: 1\nsource: text\ntext:\n  page: { width: 1, length: 1 }\n  fields: []\n' } };
    await db().update(jobs).set({ activeVersion: 1, draft: changed }).where(eq(jobs.id, otherId));

    const model = scriptedModel(toolStep('list_jobs', {}), toolStep('read_job_files', { id: otherId }), textStep('Copied.'));
    createModel.mockResolvedValue(withKey(model));
    const { parts } = await chunks(await chat());

    const outputs = parts.filter((p) => p.type === 'tool-output-available').map((p) => p.output as Record<string, unknown>);
    expect(outputs[0]).toEqual({ ok: true, jobs: [{ id: otherId, name: 'Invoices', type: 'invoice', templates: ['Document'], hasOwnContent: true }] });
    expect(outputs[1]).toEqual({
      ok: true,
      id: otherId,
      name: 'Invoices',
      definitionYaml: yaml,
      templates: [{ id: 'main', name: 'Document', formats: ['pdf'], kind: 'html', html, fileId: null }],
    });
    expect((await draft()).extract.definition).toBe('');
  });

  it('keeps the API key out of the stream when the provider fails', async () => {
    createModel.mockResolvedValue(
      withKey(
        new MockLanguageModelV4({
          doStream: async () => {
            throw new Error(`401 invalid x-api-key ${FAKE_KEY}\n    at secret (/srv/app/node_modules/provider.js:1:1)`);
          },
        }),
      ),
    );

    const response = await chat();
    const { text, parts } = await chunks(response);

    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('provider.js');
    const error = parts.find((p) => p.type === 'error') as { errorText: string } | undefined;
    expect(error?.errorText).toMatch(/invalid x-api-key \*\*\*/);
  });

  it('answers 404 for a missing job, 400 for a bad body or no preview file, 401 signed out, 503 without a model and 403 across origins', async () => {
    createModel.mockResolvedValue(withKey(scriptedModel()));
    expect((await chat({ messages }, {}, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await chat({ messages: [] })).status).toBe(400);
    expect(
      (
        await POST(
          new Request(`http://localhost:3000/api/jobs/${jobId}/chat`, {
            method: 'POST',
            headers: { origin: 'http://localhost:3000', host: 'localhost:3000', ...auth },
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

    createModel.mockResolvedValue(null);
    const none = await chat();
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ error: 'No model set up. Choose one in Settings.' });

    createModel.mockRejectedValue(new Error('The stored API key cannot be decrypted. Was SPOOLDOC_SECRET_KEY changed? Enter the API key again.'));
    const unreadable = await chat();
    expect(unreadable.status).toBe(503);
    expect(((await unreadable.json()) as { error: string }).error).toMatch(/cannot be decrypted/);
  });
});

describe('the stored thread (GET and DELETE /api/jobs/[id]/chat)', () => {
  it('is empty for a job that has none, and answers 404, 401 and 403 like the chat', async () => {
    expect(await storedThread()).toEqual([]);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await GET(appRequest(`/api/jobs/${missing}/chat`, { headers: auth }), params({ id: missing }))).status).toBe(404);
    expect((await clear(auth, missing)).status).toBe(404);
    expect((await GET(appRequest(`/api/jobs/${jobId}/chat`), params({ id: jobId }))).status).toBe(401);
    expect((await GET(appRequest(`/api/jobs/${jobId}/chat`, { headers: { ...auth, 'sec-fetch-site': 'cross-site' } }), params({ id: jobId }))).status).toBe(403);
    expect((await clear({})).status).toBe(401);
    expect((await clear({ ...auth, origin: 'https://evil.example.com' })).status).toBe(403);
  });

  it('keeps each finished turn with its tool calls, masked when masking is on, and gives the thread back to the model', async () => {
    await db().update(settings).set({ aiMask: true });
    const first = scriptedModel(toolStep('write_definition', { yaml }), textStep('Saved the invoice definition.'));
    createModel.mockResolvedValue(withKey(first));
    await chunks(await chat());

    const thread = await storedThread();
    expect(thread).toHaveLength(2);
    expect(thread[0]).toEqual(messages[0]);
    const answer = thread[1]!;
    expect(answer.role).toBe('assistant');
    expect(answer.id).toBeTruthy();
    const toolPart = answer.parts.find((p) => p.type === 'tool-write_definition') as { state: string; output: { ok: boolean; pageGroups: number } };
    expect(toolPart).toMatchObject({ state: 'output-available', output: { ok: true, pageGroups: 6 } });
    expect(answer.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Saved the invoice definition.' }));
    // The stored results are the masked ones the model saw.
    expect(JSON.stringify(thread)).not.toContain('260101');
    expect(JSON.stringify(thread)).not.toContain(FAKE_KEY);

    // The next turn sends the thread back; the model sees the earlier tool result and the whole thread is stored again.
    const second = scriptedModel(textStep('You are welcome.'));
    createModel.mockResolvedValue(withKey(second));
    const next = [...thread, { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] }];
    await chunks(await chat({ messages: next }));
    const prompt = JSON.stringify(second.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('Saved the invoice definition.');
    expect(prompt).toContain('"toolName":"write_definition"');
    const longer = await storedThread();
    expect(longer).toHaveLength(4);
    expect(longer.slice(0, 3)).toEqual(next.slice(0, 3));
    expect(longer[3]?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'You are welcome.' }));

    // New chat forgets it; the job's draft stays.
    expect((await clear()).status).toBe(204);
    expect(await storedThread()).toEqual([]);
    expect((await draft()).extract.definition).toBe(yaml);
  });

  it('leaves the thread as it was when the answer fails before its first token', async () => {
    createModel.mockResolvedValue(withKey(scriptedModel(textStep('First answer.'))));
    await chunks(await chat());
    expect(await storedThread()).toHaveLength(2);

    createModel.mockResolvedValue(
      withKey(
        new MockLanguageModelV4({
          doStream: async () => {
            throw new Error('503 overloaded');
          },
        }),
      ),
    );
    const next = [...(await storedThread()), { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Again' }] }];
    await chunks(await chat({ messages: next }));
    expect(await storedThread()).toHaveLength(2);
  });

  it('goes with the job', async () => {
    await db().insert(jobChats).values({ jobId, messages: messages as UIMessage[] });
    await db().delete(jobs).where(eq(jobs.id, jobId));
    expect(await db().select().from(jobChats)).toEqual([]);
  });
});
