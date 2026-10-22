import 'server-only';

import {
  checkDocx,
  checkTemplate,
  checkXlsx,
  readXlsx,
  spooledFileData,
  starterXlsx,
  xlsxHardRefresh,
  xlsxProblemText,
  type DocumentData,
  type XlsxTemplate,
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
  type Sample,
  type TemplateData,
  type SpooledFileId,
} from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import { FORMAT_FILES, jobSpecSchema, perSpooledFile, splfKey, type JobTemplate, type JobSpec, type Format } from '@/lib/job-spec';
import { assetNames, assetResolver } from './assets';
import { getDb } from './db';
import { jobs, jobVersions, runs, watchSeen, type RunStep } from './db/schema';
import { destinationFor, type RunDocument, type RunFile } from './destinations';
import { documentNames, documentRenderer, runFileNames, templateHtml, type DocumentRenderer } from './documents';
import { fieldTypes } from './email-message';
import { redact } from './http';
import { connectServer, isConnectionError } from './ibmi';
import { log } from './log';
import { HEARTBEAT_MS } from './retention';
import { capture, storeSample } from './samples';
import { StepError } from './step-error';
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
 * Process one spooled file with a job version: capture, extract, render the document of
 * every page group with each template to that template's formats (PDF, HTML, DOCX, XLSX)
 * with Carbone (an Excel template of the whole spooled file renders one document of all of them),
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
  let pageGroups = 0;
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
      const detail = err instanceof StepError ? err.detail : isCarboneError(err) || isConnectionError(err) ? err.detail : undefined;
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
    // The run's number comes along, for a destination that names the run.
    const [version] = await db
      .select({ spec: jobVersions.spec, jobName: jobs.name, seq: runs.seq })
      .from(jobVersions)
      .innerJoin(jobs, eq(jobs.id, jobVersions.jobId))
      .innerJoin(runs, eq(runs.id, runId))
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
        if (mismatch.length > 0) return { def, groups: [], ranges: [], mismatch };
        const result = extract(def, sample);
        if (result.pageGroups.length === 0) throw new Error('The definition finds no page groups in this spooled file.');
        return { def, groups: result.pageGroups, ranges: result.pageRanges, mismatch };
      },
      ({ groups, mismatch }) =>
        mismatch.length > 0 ? 'Not for this definition' : `${groups.length} ${groups.length === 1 ? 'page group' : 'page groups'}`,
    );
    if (extracted.mismatch.length > 0) {
      throw new SkipRun(`Skipped: the definition is not for this file (${extracted.mismatch.join('; ')}).`);
    }
    const { def, groups, ranges } = extracted;
    pageGroups = groups.length;

    // Looked up before the render, so an email destination's message template is rendered with the documents.
    const destinationLookup = destinationFor(spec.destination.destinationId);
    destinationLookup.catch(() => undefined);
    const emailSpec = spec.destination.email;
    const bodyTemplateId = emailSpec?.bodyTemplateId && (await destinationLookup.catch(() => null))?.kind === 'email' ? emailSpec.bodyTemplateId : null;

    const { files, bodies } = await step(
      'render',
      async () => renderFiles(spec, def, groups, sample, { render: await documentRenderer(), bodyTemplateId }),
      ({ files: out }) => fileCount(out),
    );

    // Each document's name and data, for a destination that fills in fields. Two page groups
    // with the same name get a number, as their files do.
    const names = documentNames(def, groups, sample, spec.render.templates.some(perSpooledFile));
    const documents: RunDocument[] = groups.map((group, index) => ({
      pageGroupIndex: index,
      name: names.pageGroups[index]!,
      pages: ranges[index] ?? null,
      data: { pg: group, splf: sample.splf },
      html: bodies.get(index) ?? null,
    }));
    if (names.spooledFile !== null) {
      documents.push({ pageGroupIndex: null, name: names.spooledFile, pages: null, data: spooledFileData(groups, sample) });
    }

    await step(
      'deliver',
      async () => {
        const destination = await destinationLookup;
        if (!destination) throw new Error('The destination is gone.');
        return destination.deliver({
          runId,
          files,
          documents,
          job: { id: request.jobId, splfKey: splfKey(request.splf) },
          destinationId: spec.destination.destinationId!,
          email: spec.destination.email,
          webhook: spec.destination.webhook,
          context: {
            job: { id: request.jobId, name: version.jobName, version: request.version },
            run: { id: runId, seq: version.seq },
            splf: request.splf,
            attributes: sample.attributes,
          },
          valueTypes: fieldTypes(def),
          conn,
          host,
          addSecret: (secret) => secrets.push(secret),
        });
      },
      (note) => note,
    );

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
  await db.update(runs).set({ status, error, steps, pageGroups, finishedAt: new Date() }).where(eq(runs.id, runId));
}

/**
 * Render the files of a run: each template in each of its formats, for every page group,
 * or once for the whole spooled file, with names made unique. With `pageGroup`, only that
 * page group's files in `formats`, for a test from the job builder. Also the HTML of the
 * email message template of each page group.
 *
 * @throws StepError when a template has problems or Carbone refuses a document
 * @throws CarboneError when Carbone cannot be reached
 */
export async function renderFiles(
  spec: JobSpec,
  def: Definition,
  groups: Record<string, unknown>[],
  sample: Sample,
  options: { render: DocumentRenderer; bodyTemplateId?: string | null; pageGroup?: number; formats?: Format[] },
): Promise<{ files: RunFile[]; bodies: Map<number, string> }> {
  const { render } = options;
  const bodyTemplateId = options.bodyTemplateId ?? null;
  const only = options.pageGroup;
  const asset = await assetResolver();
  const assets = (await assetNames()).map((entry) => entry.name);
  // Every file's name as a run of the whole spooled file gives it, also when only one page group is rendered.
  const fileName = runFileNames(spec.render.templates, def, groups, sample);
  const out: RunFile[] = [];
  // The email message of each page group, from the job's email body template.
  const bodies = new Map<number, string>();
  const bodyTemplate = bodyTemplateId ? spec.render.templates.find((t) => t.id === bodyTemplateId) : undefined;
  if (bodyTemplateId && bodyTemplate?.kind !== 'html') {
    throw new StepError('render', "The email's message template is not an HTML template of the job. Pick another one in the Destination step.");
  }
  for (const [templateIndex, template] of spec.render.templates.entries()) {
    // A preview of one page group makes no file of the whole spooled file.
    if (only !== undefined && perSpooledFile(template)) continue;
    const formats = only !== undefined && options.formats ? template.formats.filter((format) => options.formats!.includes(format)) : template.formats;
    if (only !== undefined && formats.length === 0 && template.id !== bodyTemplateId) continue;
    // Checked once per template: Carbone prints some mistakes without an error.
    const prepared = await prepareTemplate(template, def, assets);
    // The documents to make: one of the whole spooled file, or one per page group.
    const documents = perSpooledFile(template)
      ? [{ index: null, data: spooledFileData(groups, sample) as DocumentData, where: 'the spooled file' }]
      : groups.flatMap((group, index) =>
          only !== undefined && index !== only
            ? []
            : [
                {
                  index,
                  data: templateData(prepared.data, group, groups, sample) as DocumentData,
                  where: `page group ${index + 1}`,
                },
              ],
        );
    for (const document of documents) {
      const file = { pageGroupIndex: document.index, template: template.name, templateIndex };
      const renderTo = async (format: Format): Promise<Uint8Array> => {
        try {
          return await render(prepared.input(document.data, format, sample.attributes.pageWidth, asset));
        } catch (err) {
          if (isCarboneError(err) && SERVER_KINDS.includes(err.kind)) throw err;
          const text = err instanceof Error ? err.message : String(err);
          throw new StepError('render', `The "${template.name}" template, ${document.where}: ${text}`, isCarboneError(err) ? err.detail : undefined);
        }
      };
      for (const format of formats) {
        const content = await renderTo(format);
        out.push({ ...file, name: fileName(templateIndex, document.index, format), contentType: FORMAT_FILES[format].contentType, content });
        if (format === 'html' && template.id === bodyTemplateId && document.index !== null) bodies.set(document.index, new TextDecoder().decode(content));
      }
      // The message template makes no HTML file of its own: its HTML is rendered for the email only.
      if (template.id === bodyTemplateId && document.index !== null && !bodies.has(document.index)) {
        bodies.set(document.index, new TextDecoder().decode(await renderTo('html')));
      }
    }
  }
  return { files: out, bodies };
}

/** A template, checked: what `templateData` reads, and the render of one document to one format. */
interface PreparedTemplate {
  data: string | DocxTemplate | XlsxTemplate;
  input(data: DocumentData, format: Format, pageWidth: number, asset: AssetResolver): DocumentRender;
}

/** The data of a page group's document: only an Excel template of the whole spooled file gets data without `pg`. */
const pageGroupData = (data: DocumentData): TemplateData => data as TemplateData;

/**
 * A template, checked and ready to render each page group, or the whole spooled file: its
 * HTML, or its Word or Excel file (the starter when none is uploaded).
 *
 * @throws StepError when the template has problems or its file is gone
 */
async function prepareTemplate(template: JobTemplate, def: Definition, assets: string[]): Promise<PreparedTemplate> {
  const problems = (count: number, text: string) =>
    new StepError('render', `The "${template.name}" template has ${count === 1 ? '1 problem' : `${count} problems`}. ${text.replace(/\n/g, ' ')}`);
  if (template.kind === 'html') {
    const html = templateHtml(template.source, def);
    const found = checkTemplate(html, def, { assets });
    if (found.length > 0) throw problems(found.length, problemText(found.slice(0, 3)));
    return {
      data: html,
      input: (data, format, pageWidth, asset) => ({ template: html, data: pageGroupData(data), format: format === 'html' ? 'html' : 'pdf', pageWidth, asset }),
    };
  }
  let bytes: Uint8Array;
  if (template.fileId === null) {
    bytes = template.kind === 'xlsx' ? await starterXlsx(def, template.scope) : await starterDocx(def);
  } else {
    const file = await getTemplateFile(template.fileId);
    if (!file) throw new StepError('render', `The "${template.name}" template: ${TEMPLATE_FILE_GONE}`);
    bytes = file.content;
  }
  if (template.kind === 'xlsx') {
    let read: XlsxTemplate;
    try {
      read = readXlsx(bytes);
    } catch (err) {
      throw new StepError('render', `The "${template.name}" template's Excel file: ${err instanceof Error ? err.message : String(err)}`);
    }
    const found = checkXlsx(read, def, template.scope);
    if (found.length > 0) throw problems(found.length, xlsxProblemText(found.slice(0, 3)));
    // Worked out once, so a render per page group does not unzip the file again.
    const hardRefresh = xlsxHardRefresh(read);
    return { data: read, input: (data, format) => ({ kind: 'xlsx', template: bytes, data, format: format === 'xlsx' ? 'xlsx' : 'pdf', hardRefresh }) };
  }
  let read: DocxTemplate;
  try {
    read = readDocx(bytes);
  } catch (err) {
    throw new StepError('render', `The "${template.name}" template's Word file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const found = checkDocx(read, def);
  if (found.length > 0) throw problems(found.length, docxProblemText(found.slice(0, 3)));
  const converter = docxConverter(read);
  return {
    data: read,
    input: (data, format) => ({ kind: 'docx', template: bytes, data: pageGroupData(data), format: format === 'docx' ? 'docx' : 'pdf', converter }),
  };
}

/** "6 PDFs and 6 DOCX files", "1 XLSX file". */
function fileCount(files: RunFile[]): string {
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
