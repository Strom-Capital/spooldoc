import 'server-only';

import { extract, matchProblems, parseDefinition, starterTemplate, type Definition, type Sample, type SpooledFileId } from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import { jobSpecSchema, outputFileName, splfKey, type JobSpec } from '@/lib/job-spec';
import { assetResolver } from './assets';
import { getDb } from './db';
import { jobVersions, runs, watchSeen, type RunStep } from './db/schema';
import { destinationFor, type OutputFile } from './destinations';
import { htmlToPdf, renderDocuments, type RenderedDocument } from './documents';
import { redact } from './http';
import { connectServer } from './ibmi';
import { log } from './log';
import { HEARTBEAT_MS } from './retention';
import { capture, storeSample } from './samples';

/** What starts a run. */
export interface RunRequest {
  jobId: string;
  version: number;
  splf: SpooledFileId;
  trigger: 'manual' | 'watch';
  userId?: string | null;
}

/** Turns HTML into PDF bytes; replaced in tests. */
export type PdfRenderer = (html: string, pageWidth: number) => Promise<Uint8Array>;

let pdfRenderer: PdfRenderer = htmlToPdf;

/** Use another PDF renderer, for tests. */
export function setPdfRenderer(next: PdfRenderer | null): void {
  pdfRenderer = next ?? htmlToPdf;
}

/** Ends a run as skipped: the file is not one the definition is for. The file is left alone. */
class SkipRun extends Error {}

class StepError extends Error {
  constructor(
    readonly step: RunStep['step'],
    message: string,
  ) {
    super(message);
  }
}

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
 * with each output's template to that output's formats (PDF, HTML or both), deliver, then hold, move or delete the file as the version says. Every step is
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
      steps.push({ step: name, ok: false, ms: Math.round(performance.now() - started), error: message });
      throw new StepError(name, message);
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
        const asset = await assetResolver();
        const names = new Set<string>();
        const unique = (base: string, ext: string) => {
          let name = `${base}.${ext}`;
          for (let n = 2; names.has(name); n++) name = `${base}-${n}.${ext}`;
          names.add(name);
          return name;
        };
        const out: OutputFile[] = [];
        for (const [outputIndex, output] of spec.render.outputs.entries()) {
          let rendered: RenderedDocument[];
          try {
            rendered = renderDocuments(def, output.template.source ?? starterTemplate(def), docs, sample, asset);
          } catch (err) {
            throw new Error(`The "${output.label}" output's template has an error: ${err instanceof Error ? err.message : String(err)}`);
          }
          for (const doc of rendered) {
            const base = outputFileName(doc.name, spec.render.outputs, output);
            const file = { documentIndex: doc.index, output: output.label, outputIndex };
            for (const format of output.formats) {
              out.push(
                format === 'pdf'
                  ? { ...file, name: unique(base, 'pdf'), contentType: 'application/pdf', content: await pdfRenderer(doc.html, sample.attributes.pageWidth) }
                  : { ...file, name: unique(base, 'html'), contentType: 'text/html; charset=utf-8', content: new TextEncoder().encode(doc.html) },
              );
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

/** "6 PDFs and 6 HTML files". */
function fileCount(files: OutputFile[]): string {
  const pdf = files.filter((f) => f.contentType === 'application/pdf').length;
  const html = files.length - pdf;
  const parts = [pdf ? `${pdf} PDF${pdf === 1 ? '' : 's'}` : '', html ? `${html} HTML file${html === 1 ? '' : 's'}` : ''].filter(Boolean);
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
