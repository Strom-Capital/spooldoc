import 'server-only';

import { isCarboneError, type Definition, type Sample } from '@spooldoc/core';
import { redact } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sftpConfigSchema, sftpTarget, type IfExists, type SftpConfig } from '@/lib/destination-config';
import { FORMAT_FILES, perSpooledFile, spooledFileName, templateFileName, type JobSpec } from '@/lib/job-spec';
import type { SftpEntryView, SftpFolderView, SftpOutcome, SftpUploadTestView } from '@/lib/types';
import { getDb } from './db';
import { destinations } from './db/schema';
import { key, numbered, ownNames } from './destinations/names';
import { notUploaded, openSftpSecrets, sftpConnector, sftpSecretValues, sftpTargetOf, type SftpSecrets } from './destinations/sftp';
import { fileNameFor, previewRenderer } from './documents';
import { errorResponse, json } from './http';
import { draftPageGroup } from './job-preview';
import type { JobRow } from './jobs';
import { CARBONE_NOT_CONNECTED } from './render';
import { renderFiles } from './runner';
import { findFolder, inFolder, isNoSuchFile, listFolder, SftpError, sftpErrorText, statPath, uploadFile, type SftpEntry } from './sftp';
import { StepError } from './step-error';

/** A folder view or an Upload test, from the job builder. */
export const sftpFolderSchema = z.object({
  destinationId: z.string().uuid().nullable().optional(),
  pageGroupIndex: z.number().int().nonnegative().default(0),
  sampleId: z.string().uuid().optional(),
  /** Read the folder again instead of the listing of the last minute. */
  refresh: z.boolean().default(false),
});

/** How long a listing is used again, so stepping through page groups does not reconnect. */
const CACHE_MS = 60_000;

interface Listing {
  entries: SftpEntry[];
  truncated: boolean;
  /** The folder as the server resolves it. */
  real: string;
  readAt: number;
}

/** Folder listings of the last minute, by destination and folder. */
const listings = new Map<string, Listing>();

const cacheKey = (destinationId: string, config: SftpConfig, folder: string) => `${destinationId}\n${config.host}\n${config.port}\n${config.username}\n${folder}`;

/** Forget the listings of a destination, such as after an Upload test. */
export function forgetListings(destinationId: string): void {
  for (const id of listings.keys()) if (id.startsWith(`${destinationId}\n`)) listings.delete(id);
}

/** The SFTP destination a request names, or the draft's, with its settings and secrets; or a response that says what is wrong. */
async function pickDestination(
  job: JobRow,
  draft: JobSpec,
  destinationId: string | null | undefined,
): Promise<{ id: string; name: string; config: SftpConfig; secrets: SftpSecrets } | { response: Response }> {
  const id = destinationId ?? draft.destination.destinationId;
  const [row] = id ? await getDb().select().from(destinations).where(eq(destinations.id, id)) : [];
  if (row?.kind !== 'sftp') return { response: errorResponse(400, 'Pick an SFTP destination first.') };
  const config = sftpConfigSchema.safeParse(row.config);
  if (!config.success) return { response: errorResponse(422, `The settings of ${row.name} are not valid. Open it on the Destinations page and save it again.`) };
  try {
    return { id: row.id, name: row.name, config: config.data, secrets: openSftpSecrets(row.secretsEnc) };
  } catch (error) {
    return { response: errorResponse(409, `${error instanceof Error ? error.message : String(error)} Open ${row.name} on the Destinations page and make a new key or enter the password again.`) };
  }
}

/**
 * The names of the files a run uploads with a page group, as the runner names them,
 * without rendering: each template of a page group in each of its formats, the first
 * template's files named after the document, the others after the template too. Then the
 * files of the whole spooled file, such as an Excel workbook of every page group, named
 * after the spooled file: a run uploads them once, so every page group shows them.
 */
export function pageGroupFileNames(spec: JobSpec, def: Definition, group: Record<string, unknown>, index: number, sample: Sample): { name: string; whole: boolean }[] {
  const names = new Set<string>();
  const out: { name: string; whole: boolean }[] = [];
  const add = (base: string, template: JobSpec['render']['templates'][number], whole: boolean) => {
    const name = templateFileName(base, spec.render.templates, template);
    for (const format of template.formats) {
      const extension = FORMAT_FILES[format].extension;
      let file = `${name}.${extension}`;
      for (let n = 2; names.has(file); n++) file = `${name}-${n}.${extension}`;
      names.add(file);
      out.push({ name: file, whole });
    }
  };
  const base = fileNameFor(def, group, index, sample.splf.name.toLowerCase());
  for (const template of spec.render.templates) if (!perSpooledFile(template)) add(base, template, false);
  for (const template of spec.render.templates) if (perSpooledFile(template)) add(spooledFileName(sample), template, true);
  return out;
}

/**
 * What a run does to each file in the folder: New, Replaces the file there, Becomes a name
 * with a number, or Fails the run. Names are compared as a folder that ignores case
 * compares them, as the run does.
 */
export function outcomes(names: string[], entries: Pick<SftpEntry, 'name' | 'mtime'>[], ifExists: IfExists): SftpOutcome[] {
  const there = new Map(entries.map((entry) => [key(entry.name), entry]));
  const own = ownNames(names.map((name) => ({ name })));
  const used = new Set([...own.map(key), ...there.keys()]);
  return own.map((name, at) => {
    const found = there.get(key(name));
    if (!found) return name === names[at] ? { kind: 'new' } : { kind: 'becomes', name };
    if (ifExists === 'replace') return { kind: 'replaces', mtime: found.mtime === null ? null : new Date(found.mtime * 1000).toISOString() };
    if (ifExists === 'fail') return { kind: 'fails' };
    let n = 2;
    while (used.has(key(numbered(name, n)))) n++;
    used.add(key(numbered(name, n)));
    return { kind: 'becomes', name: numbered(name, n) };
  });
}

const entryView = (entry: SftpEntry): SftpEntryView => ({
  name: entry.name,
  size: entry.size,
  mtime: entry.mtime === null ? null : new Date(entry.mtime * 1000).toISOString(),
  folder: entry.folder,
});

/** A failure as an answer: 502 with the error and the server's own text, without secrets. */
function failure(err: unknown, secrets: SftpSecrets): Response {
  const hidden = sftpSecretValues(secrets);
  const message = err instanceof Error ? err.message : String(err);
  const detail = err instanceof SftpError ? err.detail : undefined;
  return json({ error: err instanceof SftpError ? message : redact(message, hidden), ...(detail ? { detail: redact(detail, hidden) } : {}) }, { status: 502 });
}

/**
 * The folder runs write to (the test folder in test mode), listed, with one page group's
 * files placed in it and tagged with what a run will do. The listing is used again for a
 * minute, so stepping through page groups does not reconnect; `refresh` reads it again.
 * Nothing is written.
 */
export async function sftpFolder(job: JobRow, input: z.infer<typeof sftpFolderSchema>): Promise<Response> {
  const picked = await draftPageGroup(job, { sampleId: input.sampleId, pageGroup: input.pageGroupIndex }, 'the files');
  if ('response' in picked) return picked.response;
  const { draft, sample, def, groups, index } = picked;
  const destination = await pickDestination(job, draft, input.destinationId);
  if ('response' in destination) return destination.response;
  const { config } = destination;
  const testMode = config.testFolder !== null;
  const folder = config.testFolder ?? config.folder;
  if (!config.hostKey) {
    return json(
      { error: `The host key of ${config.host} is not trusted yet. Open ${destination.name} on the Destinations page, check the connection and trust the key.`, untrusted: true },
      { status: 409 },
    );
  }

  const id = cacheKey(destination.id, config, folder);
  let listing = input.refresh ? undefined : listings.get(id);
  if (listing && Date.now() - listing.readAt > CACHE_MS) listing = undefined;
  if (!listing) {
    try {
      const session = await sftpConnector.connect(sftpTargetOf(config, destination.secrets));
      try {
        const real = await findFolder(session, folder);
        const read = await listFolder(session, real);
        listing = { ...read, real, readAt: Date.now() };
      } finally {
        session.close();
      }
    } catch (err) {
      return failure(err, destination.secrets);
    }
    listings.set(id, listing);
  }

  const named = pageGroupFileNames(draft, def, groups[index]!, index, sample);
  const names = named.map((file) => file.name);
  const files: Pick<SftpEntry, 'name' | 'mtime'>[] = listing.entries.filter((entry) => !entry.folder);
  if (listing.truncated) {
    // A folder read in part may hold a name past the part read: look each one up.
    const read = new Set(files.map((entry) => key(entry.name)));
    const missing = names.filter((name) => !read.has(key(name)));
    if (missing.length > 0) {
      try {
        const session = await sftpConnector.connect(sftpTargetOf(config, destination.secrets));
        try {
          for (const name of missing) {
            const path = inFolder(listing.real, name);
            let stats: { mtime: number } | null;
            try {
              stats = await session.call<{ mtime: number }>(`looked for ${name}`, (done) => session.sftp.stat(path, done));
            } catch (err) {
              // Only a name that is not there is not there; any other error is said.
              if (!isNoSuchFile(err)) {
                if (err instanceof SftpError) throw err;
                const { message, detail } = sftpErrorText(err, { ...session.ctx, op: { action: 'read', path, folder: listing.real } });
                throw new SftpError(message, 'work', detail);
              }
              stats = null;
            }
            if (stats) files.push({ name, mtime: stats.mtime });
          }
        } finally {
          session.close();
        }
      } catch (err) {
        return failure(err, destination.secrets);
      }
    }
  }
  const view: SftpFolderView = {
    target: sftpTarget({ ...config, folder }),
    folder,
    testMode,
    ifExists: config.ifExists,
    pageGroup: index,
    pageGroups: groups.length,
    files: outcomes(names, files, config.ifExists).map((outcome, at) => ({ name: names[at]!, outcome, ...(named[at]!.whole ? { whole: true } : {}) })),
    entries: [...listing.entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(entryView),
    truncated: listing.truncated,
    readAt: new Date(listing.readAt).toISOString(),
  };
  return json(view);
}

/**
 * Upload one page group of the preview spooled file, rendered from the draft, to the test
 * folder, with the destination's same-name rule and temporary names. Refused (409)
 * without a test folder, so a test never lands where the receiver picks up files. Nothing
 * is recorded in the Job log.
 */
export async function sftpUploadTest(job: JobRow, input: z.infer<typeof sftpFolderSchema>): Promise<Response> {
  const picked = await draftPageGroup(job, { sampleId: input.sampleId, pageGroup: input.pageGroupIndex }, 'the files');
  if ('response' in picked) return picked.response;
  const { draft, sample, def, groups, index } = picked;
  const destination = await pickDestination(job, draft, input.destinationId);
  if ('response' in destination) return destination.response;
  const { config, secrets } = destination;
  if (!config.testFolder) {
    return errorResponse(409, 'Set a test folder on the destination first, so a test never lands where the receiver picks up files.');
  }
  if (!config.hostKey) {
    return errorResponse(409, `The host key of ${config.host} is not trusted yet. Open ${destination.name} on the Destinations page, check the connection and trust the key.`);
  }

  const render = await previewRenderer();
  if (!render) return errorResponse(503, CARBONE_NOT_CONNECTED);
  let files;
  try {
    files = (await renderFiles(draft, def, groups, sample, { render, pageGroup: index })).files.filter((file) => file.pageGroupIndex === index);
    // The files of the whole spooled file, such as an Excel workbook of every page group:
    // a run uploads them with the page groups' files, so the test does too. Only those
    // templates render here; the others make no file.
    if (draft.render.templates.some(perSpooledFile)) {
      const whole = { ...draft, render: { ...draft.render, templates: draft.render.templates.map((template) => (perSpooledFile(template) ? template : { ...template, formats: [] })) } };
      files.push(...(await renderFiles(whole, def, groups, sample, { render })).files.filter((file) => file.pageGroupIndex === null));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof StepError || isCarboneError(error) ? error.detail : undefined;
    return json({ error: `Could not render the files. ${message}`, ...(detail ? { detail } : {}) }, { status: isCarboneError(error) ? 503 : 422 });
  }

  if (files.length === 0) {
    return errorResponse(422, 'The templates make no files for this page group, so there is nothing to upload. Add a format to a template in the Render step.');
  }
  const hidden = sftpSecretValues(secrets);
  const clean = (text: string) => redact(text, hidden);
  const started = performance.now();
  const view: SftpUploadTestView = { folder: config.testFolder, ms: 0, files: [] };
  try {
    const session = await sftpConnector.connect(sftpTargetOf(config, secrets));
    try {
      const real = await findFolder(session, config.testFolder);
      const own = ownNames(files);
      const used = new Set(own.map(key));
      for (const [at, file] of files.entries()) {
        const begun = performance.now();
        try {
          let first = 1;
          if (config.ifExists === 'suffix' && (await statPath(session, inFolder(real, own[at]!), `looked for ${own[at]}`)) !== null) {
            first = 2;
            while (used.has(key(numbered(own[at]!, first))) || (await statPath(session, inFolder(real, numbered(own[at]!, first)), `looked for ${own[at]}`)) !== null) first++;
          }
          const result = await uploadFile(session, real, own[at]!, file.content, { ifExists: config.ifExists, tempName: config.tempName, avoid: used, first });
          used.add(key(result.finalName));
          view.files.push({ name: file.name, finalName: result.finalName, size: file.content.byteLength, ms: Math.round(performance.now() - begun), ...(file.pageGroupIndex === null ? { whole: true } : {}) });
        } catch (err) {
          const detail = err instanceof SftpError ? err.detail : undefined;
          view.files.push({
            name: file.name,
            finalName: own[at]!,
            size: file.content.byteLength,
            ms: Math.round(performance.now() - begun),
            error: err instanceof SftpError ? err.message : clean(err instanceof Error ? err.message : String(err)),
            ...(detail ? { detail: clean(detail) } : {}),
          });
          if (session.closed) {
            // The files not tried say why, as in a run.
            const reason = err instanceof SftpError ? (err.extra.reason ?? err.message) : clean(err instanceof Error ? err.message : String(err));
            for (const [later, other] of files.slice(at + 1).entries()) {
              view.files.push({
                name: other.name,
                finalName: own[at + 1 + later]!,
                size: other.content.byteLength,
                ms: 0,
                error: notUploaded(reason),
                ...(detail ? { detail: clean(detail) } : {}),
                ...(other.pageGroupIndex === null ? { whole: true } : {}),
              });
            }
            break;
          }
        }
      }
    } finally {
      session.close();
    }
  } catch (err) {
    return failure(err, secrets);
  } finally {
    forgetListings(destination.id);
  }
  view.ms = Math.round(performance.now() - started);
  return json(view, { status: view.files.some((file) => file.error) ? 502 : 200 });
}
