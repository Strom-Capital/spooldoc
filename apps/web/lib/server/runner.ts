import 'server-only';

import {
  checkDocx,
  checkTemplate,
  docxConverter,
  docxProblemText,
  extract,
  isCarboneError,
  matchProblems,
  parseDefinition,
  problemText,
  readDocx,
  starterDocx,
  templateData,
  type AssetResolver,
  type Definition,
  type DocumentRender,
  type DocxTemplate,
  type TemplateData,
  type Sample,
  type SpooledFileId,
} from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import { FORMAT_FILES, jobSpecSchema, outputFileName, splfKey, type JobOutput, type JobSpec, type OutputFormat } from '@/lib/job-spec';
import { assetNames, assetResolver } from './assets';
import { getDb } from './db';
import { jobVersions, runs, watchSeen, type RunStep } from './db/schema';
import { destinationFor, type OutputFile } from './destinations';
import { documentRenderer, fileNameFor, outputTemplate } from './documents';
import { redact } from './http';
import { connectServer } from './ibmi';
import { log } from './log';
import { HEARTBEAT_MS } from './retention';
import { capture, storeSample } from './samples';
import { getTemplateFile, TEMPLATE_FILE_GONE } from './template-files';

/** What starts a run. */
export interface RunRequest {
  jobId: string;
  version: number;
  splf: SpooledFileId;
  trigger: 'manual' | 'watch';
  userId?: string | null;
}

/** Ends a run as skipped: the file is not one the definition is for. The file is left alone. */
class SkipRun extends Error {}

class StepError extends Error {
  constructor(
    readonly step: RunStep['step'],
    message: string,
    /** The system's own text, such as Carbone's, kept for support. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Shown as it is: the problem is the Carbone server, not the template. */
const SERVER_KINDS = ['unreachable', 'timeout', 'auth', 'server'];

const firstLine = (error: unknown, secrets: string[]): string => redact(error, secrets);

/**
 * Insert the run row and remember the file as seen by the job, in one transaction.
 *
 * @returns The run id
 */
export async function startRun(request: RunRequest): Promise<{ id: string; seq: number }> {
  return getDb().transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({ jobId: request.jobId, version: request.version, trigger: request.trigger, splf: request.splf, createdBy: request.userId ?? null })
      .returning({ id: runs.id, seq: runs.seq });
    await tx
      .insert(watchSeen)
      .values({ jobId: request.jobId, splfKey: splfKey(request.splf), runId: run!.id })
      .onConflictDoUpdate({ target: [watchSeen.jobId, watchSeen.splfKey], set: { runId: run!.id, seenAt: new Date() } });
    return run!;
  });
}

/**
 * Process one spooled file with a job version: capture, extract, render every document
 * with each output's template to that output's formats (PDF, HTML or both) with Carbone,
 * deliver, then hold, move or delete the file as the version says. Every step is
 * recorded on the run; a failure stops the run and is stored, never thrown. A file the
 * definition's `match` rules do not accept ends the run as `skipped`, untouched. The
 * finish step runs only after everything was delivered, and a failure there gives `warning`.
 *
 * @param runId - The run from `startRun`
 * @param request - The job, version and spooled file
 * @param connection - An open connection, for the watcher; otherwise one is opened
 */
export async function executeRun(runId: string, request: RunRequest, connection?: { conn: Connection; host: string; serverId: string; password: string }): Promise<void> {
  const db = getDb();
  const steps: RunStep[] = [];
  const secrets: string[] = connection ? [connection.password] : [];
  let documents = 0;
  let status: 'success' | 'warning' | 'failed' | 'skipped' = 'success';
  let error: string | null = null;

  const step = async <T>(name: RunStep['step'], fn: () => Promise<T>, note?: (value: T) => string | undefined): Promise<T> => {
    const started = performance.now();
    try {
      const value = await fn();
      steps.push({ step: name, ok: true, ms: Math.round(performance.now() - started), ...(note ? { note: note(value) } : {}) });
      return value;
    } catch (err) {
      const message = err instanceof StepError ? err.message : firstLine(err, secrets);
      const detail = err instanceof StepError ? err.detail : isCarboneError(err) ? err.detail : undefined;
      steps.push({ step: name, ok: false, ms: Math.round(performance.now() - started), error: message, ...(detail ? { detail } : {}) });
      throw new StepError(name, message, detail);
    }
  };

  // While the run runs, its heartbeat says the process is alive (see `failStaleRuns`).
  const heartbeat = setInterval(() => {
    db.update(runs)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
      .catch((err: unknown) => log.warn('Could not record a run heartbeat', { runId, error: redact(err, secrets) }));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const [version] = await db
      .select({ spec: jobVersions.spec })
      .from(jobVersions)
      .where(and(eq(jobVersions.jobId, request.jobId), eq(jobVersions.number, request.version)));
    if (!version) {
      throw new StepError('capture', `Version ${request.version} of the job is gone.`);
    }
    const spec: JobSpec = jobSpecSchema.parse(version.spec);

    const { conn, host, serverId } = await step('capture', async () => {
      if (connection) return connection;
      if (!spec.source.serverId) throw new Error('The job has no source server.');
      const opened = await connectServer(spec.source.serverId);
      secrets.push(opened.password);
      return { conn: opened.conn, host: opened.server.host, serverId: opened.server.id, password: opened.password };
    });

    const sample: Sample = await step(
      'capture',
      async () => {
        const captured = await capture(conn, host, request.splf);
        const stored = await storeSample(serverId, captured, runId);
        await db.update(runs).set({ sampleId: stored.id }).where(eq(runs.id, runId));
        return stored;
      },
      (s) => `${s.pages.length} ${s.pages.length === 1 ? 'page' : 'pages'}`,
    );
    const extracted = await step(
      'extract',
      async () => {
        const def: Definition = parseDefinition(spec.extract.definition);
        // A file the definition is not for (its `match` rules) is skipped, not failed.
        const mismatch = matchProblems(def, sample);
        if (mismatch.length > 0) return { def, docs: [], mismatch };
        const result = extract(def, sample);
        if (result.documents.length === 0) throw new Error('The definition finds no documents in this spooled file.');
        return { def, docs: result.documents, mismatch };
      },
      ({ docs, mismatch }) =>
        mismatch.length > 0 ? 'Not for this definition' : `${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`,
    );
    if (extracted.mismatch.length > 0) {
      throw new SkipRun(`Skipped: the definition is not for this file (${extracted.mismatch.join('; ')}).`);
    }
    const { def, docs } = extracted;
    documents = docs.length;

    const files: OutputFile[] = await step(
      'render',
      async () => {
        const render = await documentRenderer();
        const asset = await assetResolver();
        const assets = (await assetNames()).map((entry) => entry.name);
        const names = new Set<string>();
        const unique = (base: string, ext: string) => {
          let name = `${base}.${ext}`;
          for (let n = 2; names.has(name); n++) name = `${base}-${n}.${ext}`;
          names.add(name);
          return name;
        };
        const out: OutputFile[] = [];
        for (const [outputIndex, output] of spec.render.outputs.entries()) {
          // Checked once per output: Carbone prints some mistakes without an error.
          const prepared = await prepareOutput(output, def, assets);
          for (const [index, doc] of docs.entries()) {
            const base = outputFileName(fileNameFor(def, doc, index, sample.splf.name.toLowerCase()), spec.render.outputs, output);
            const file = { documentIndex: index, output: output.label, outputIndex };
            for (const format of output.formats) {
              let content: Uint8Array;
              try {
                content = await render(prepared.input(templateData(prepared.data, doc, docs, sample), format, sample.attributes.pageWidth, asset));
              } catch (err) {
                if (isCarboneError(err) && SERVER_KINDS.includes(err.kind)) throw err;
                const text = err instanceof Error ? err.message : String(err);
                throw new StepError('render', `The "${output.label}" output, document ${index + 1}: ${text}`, isCarboneError(err) ? err.detail : undefined);
              }
              const { extension, contentType } = FORMAT_FILES[format];
              out.push({ ...file, name: unique(base, extension), contentType, content });
            }
          }
        }
        return out;
      },
      (out) => fileCount(out),
    );

    await step('deliver', async () => {
      const destination = await destinationFor(spec.destination.destinationId);
      if (!destination) throw new Error('The destination is gone.');
      await db.transaction((tx) => destination.deliver({ runId, files, tx }));
    });

    try {
      await step(
        'finish',
        async () => {
          const { action, queue } = spec.finish;
          if (action === 'hold') await conn.holdSpooledFile(request.splf);
          else if (action === 'move' && queue) await conn.moveSpooledFile(request.splf, queue);
          else if (action === 'delete') await conn.deleteSpooledFile(request.splf);
          return action;
        },
        (action) =>
          action === 'hold'
            ? 'Held'
            : action === 'move'
              ? `Moved to ${spec.finish.queue?.library}/${spec.finish.queue?.name}`
              : action === 'delete'
                ? 'Deleted'
                : 'Left as is',
      );
    } catch (err) {
      status = 'warning';
      error = `Delivered, but the spooled file was not handled: ${err instanceof Error ? err.message : String(err)}`;
    }
  } catch (err) {
    status = err instanceof SkipRun ? 'skipped' : 'failed';
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearInterval(heartbeat);
  }

  mergeCapture(steps);
  await db.update(runs).set({ status, error, steps, documents, finishedAt: new Date() }).where(eq(runs.id, runId));
}

/** An output's template, checked: what `templateData` reads, and the render of one document to one format. */
interface PreparedOutput {
  data: string | DocxTemplate;
  input(data: TemplateData, format: OutputFormat, pageWidth: number, asset: AssetResolver): DocumentRender;
}

/**
 * An output's template, checked and ready to render each document: an HTML template, or
 * a Word template's file (the starter template when none is uploaded).
 *
 * @throws StepError when the template has problems or its file is gone
 */
async function prepareOutput(output: JobOutput, def: Definition, assets: string[]): Promise<PreparedOutput> {
  const problems = (count: number, text: string) =>
    new StepError('render', `The "${output.label}" output's template has ${count === 1 ? '1 problem' : `${count} problems`}. ${text.replace(/\n/g, ' ')}`);
  if (output.template.kind === 'html') {
    const template = outputTemplate(output.template.source, def);
    const found = checkTemplate(template, def, { assets });
    if (found.length > 0) throw problems(found.length, problemText(found.slice(0, 3)));
    return {
      data: template,
      input: (data, format, pageWidth, asset) => ({ template, data, format: format === 'html' ? 'html' : 'pdf', pageWidth, asset }),
    };
  }
  let bytes: Uint8Array;
  if (output.template.fileId === null) {
    bytes = await starterDocx(def);
  } else {
    const file = await getTemplateFile(output.template.fileId);
    if (!file) throw new StepError('render', `The "${output.label}" output: ${TEMPLATE_FILE_GONE}`);
    bytes = file.content;
  }
  let read: DocxTemplate;
  try {
    read = readDocx(bytes);
  } catch (err) {
    throw new StepError('render', `The "${output.label}" output's Word template: ${err instanceof Error ? err.message : String(err)}`);
  }
  const found = checkDocx(read, def);
  if (found.length > 0) throw problems(found.length, docxProblemText(found.slice(0, 3)));
  const converter = docxConverter(read);
  return {
    data: read,
    input: (data, format) => ({ kind: 'docx', template: bytes, data, format: format === 'docx' ? 'docx' : 'pdf', converter }),
  };
}

/** "6 PDFs and 6 DOCX files". */
function fileCount(files: OutputFile[]): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const label = Object.values(FORMAT_FILES).find((f) => f.contentType === file.contentType)?.label ?? 'other';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, n]) => (label === 'PDF' ? `${n} PDF${n === 1 ? '' : 's'}` : `${n} ${label} file${n === 1 ? '' : 's'}`));
  return parts.join(' and ') || 'No files';
}

/** Two capture entries (connect, read) become one. */
function mergeCapture(steps: RunStep[]): void {
  const captures = steps.filter((s) => s.step === 'capture');
  if (captures.length === 2) {
    const [a, b] = captures as [RunStep, RunStep];
    steps.splice(steps.indexOf(a), 2, { ...b, ms: a.ms + b.ms });
  }
}

/** Start and finish a run. Returns the run id. */
export async function runJob(request: RunRequest, connection?: Parameters<typeof executeRun>[2]): Promise<string> {
  const { id } = await startRun(request);
  await executeRun(id, request, connection);
  return id;
}
