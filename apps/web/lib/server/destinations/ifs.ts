import 'server-only';

import type { IfsWriteOptions, IfsWriteResult } from '@spooldoc/ibmi';
import type { IfsConfig } from '@/lib/destination-config';
import { isConnectionError } from '../ibmi';
import { StepError } from '../step-error';
import type { DeliverInput, Destination } from './index';
import { deliveryFailed, deliveryLock, deliveryRecorder, documentFields, earlierDeliveries, earlierText, sentBefore, type DeliveredDocument } from './deliveries';
import { key, numbered, ownNames, SUFFIX_TRIES } from './names';
import { nFiles, type RunFile } from './store';

/** The CCSID a file is tagged with: UTF-8 for text such as HTML, binary for PDF, DOCX and XLSX. */
export function ccsidFor(contentType: string): number {
  return /^text\/|[/+](json|xml)\b/.test(contentType) ? 1208 : 65535;
}

/** "Not written: ..." for the files a stop leaves untried. */
export const notWritten = (message: string) => `Not written: ${message}`;

const reason = (err: unknown): { message: string; detail?: string } => {
  const message = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
  const detail = err instanceof Error && 'detail' in err && typeof err.detail === 'string' ? err.detail : undefined;
  return { message, detail };
};

const taken = (err: unknown): boolean => isConnectionError(err) && err.code === 'exists';

/**
 * True when a failed write says the rest would fail too: the connection or the sign-on is
 * the problem, not the file. More tries after a sign-on failure could also disable the
 * profile.
 */
const stops = (err: unknown): boolean => !isConnectionError(err) || err.code === 'host' || err.code === 'auth' || err.code === 'timeout';

/**
 * Writes each file of a run to a folder in the IFS of the job's server. Spooldoc never
 * creates the folder. With `keepCopy`, the files are kept in Spooldoc first, so they can
 * be downloaded even when the write fails.
 *
 * A file an earlier run of the same job already wrote for the same spooled file, through
 * this destination to this folder, is not written again, so Retry writes only the rest:
 * the same spooled file has the same creation time, and the file's page group the same
 * pages. Such a file is not in the way of itself. One run at a time writes for a job and
 * spooled file; a second waits for the first.
 *
 * Every other name is checked before anything is written, and checked again by the write,
 * at the moment the file is renamed into place: a file another run wrote in between is
 * replaced only with Replace. A file that fails fails alone, and the others are still
 * written; a lost connection or a sign-on failure stops the run, and the files not tried
 * say why. Every file is recorded as it goes. The step fails when any file failed.
 */
export function ifsDestination(config: IfsConfig): Destination {
  const { folder, ifExists, keepCopy } = config;
  const pathOf = (name: string) => `${folder}/${name}`;
  return {
    kind: 'ifs',
    async deliver(input: DeliverInput) {
      const { files, documents, conn, host, job } = input;
      if (keepCopy) {
        await input.keepFiles(files);
      }

      // The spooled file's creation time, as the run read it; "" when the IBM i did not give it.
      const created = input.context.attributes.created;
      // Each file as a document of its own: its name, with its page group's pages.
      const pagesOf = new Map(documents.map((document) => [document.pageGroupIndex, document.pages]));
      const asDocument = (file: RunFile): DeliveredDocument => ({ pageGroupIndex: file.pageGroupIndex, name: file.name, pages: pagesOf.get(file.pageGroupIndex) ?? null });
      const fields = (file: RunFile) => ({ ...documentFields(asDocument(file), created), size: file.content.byteLength });
      // The run each file was written in before, for the files not written again.
      const sentIn = new Map<RunFile, number>();

      const record = deliveryRecorder(input, 'ifs');

      const own = ownNames(files);
      let pending = files.map((file, index) => ({ file, name: own[index]! }));

      const failures: { message: string; detail?: string }[] = [];
      let written = 0;
      let replaced = 0;
      let added = 0;
      const leftovers: string[] = [];

      /** Fails every file from `from` on with the reason the run stopped. */
      const stopAll = async (from: number, why: { message: string; detail?: string }) => {
        for (const { file } of pending.slice(from)) {
          await record({ ...fields(file), to: '', status: 'failed', error: notWritten(why.message), detail: why.detail ?? null });
        }
      };
      /** Fails every file not written yet with `message`, and the step with it. */
      const stop = async (message: string, detail?: string): Promise<never> => {
        await stopAll(0, { message, detail });
        throw new StepError('deliver', message, detail);
      };

      const release = await deliveryLock('ifs', job, 'Another run of this job is writing files of this spooled file. Retry when it has finished.');
      try {
        // Files written by earlier runs of this job on this spooled file, through this
        // destination, directly in this folder. The IFS destination has no test folder.
        const inFolder = `${folder}/`;
        const earlier = (await earlierDeliveries(input, 'ifs', false)).filter(
          (row) => row.status === 'sent' && row.to.startsWith(inFolder) && !row.to.slice(inFolder.length).includes('/'),
        );
        for (const file of files) {
          const before = sentBefore(earlier, asDocument(file), created);
          if (before === undefined) continue;
          sentIn.set(file, before.seq);
          await record({ ...fields(file), to: '', status: 'already_sent', sentInRun: before.seq });
        }
        pending = pending.filter(({ file }) => !sentIn.has(file));

        if (pending.length > 0) {
          // Names taken, by this run or in the folder, compared as the IFS compares them.
          const used = new Set(own.map(key));
          const names = pending.map((item) => item.name);
          const free = async (name: string) => !used.has(key(name)) && (await conn.ifsStat(pathOf(name))) === null;
          /** The first free number for a file, from `n` on. */
          const nextFree = async (name: string, n: number) => {
            while (!(await free(numbered(name, n)))) n++;
            return n;
          };

          let at: Awaited<ReturnType<typeof conn.ifsStat>>;
          const inTheWay: string[] = [];
          try {
            at = await conn.ifsStat(folder);
            if (at === 'directory' && ifExists === 'fail') {
              // Every name is checked first: when any is taken, nothing is written.
              for (const name of names) {
                if ((await conn.ifsStat(pathOf(name))) !== null) inTheWay.push(name);
              }
            } else if (at === 'directory' && ifExists === 'suffix') {
              for (const [index, name] of names.entries()) {
                if ((await conn.ifsStat(pathOf(name))) === null) continue;
                const numberedName = numbered(name, await nextFree(name, 2));
                used.add(key(numberedName));
                names[index] = numberedName;
              }
            }
          } catch (err) {
            const why = reason(err);
            return await stop(why.message, why.detail);
          }
          if (at === 'file') {
            await stop(`${folder} on ${host} is a file, not a folder. Change the destination's folder.`);
          }
          if (at === null) {
            await stop(`The folder ${folder} does not exist on ${host}. Create it, or change the destination's folder.`);
          }
          if (inTheWay.length > 0) {
            const more = inTheWay.length > 1 ? ` and ${nFiles(inTheWay.length - 1)} more are` : ' is';
            await stop(
              `${inTheWay[0]}${more} already in ${folder}. Nothing was written. Change "When a file with the same name exists" or move the old ${inTheWay.length > 1 ? 'files' : 'file'}.`,
            );
          }

          // Replace replaces at the moment of the rename. The other two never do: a name that
          // was taken in between fails the file, or, with Add a number, gets the next number.
          const options = (file: RunFile): IfsWriteOptions => ({ ccsid: ccsidFor(file.contentType), ifExists: ifExists === 'replace' ? 'replace' : 'fail' });

          const writeOne = async (index: number, file: RunFile): Promise<IfsWriteResult> => {
            for (let tries = 1; ; tries++) {
              try {
                return await conn.writeIfsFile(pathOf(names[index]!), file.content, options(file));
              } catch (err) {
                if (ifExists !== 'suffix' || !taken(err) || tries >= SUFFIX_TRIES) throw err;
                // Another run took the name since it was checked: take the next free number.
                const name = pending[index]!.name;
                names[index] = numbered(name, await nextFree(name, 2));
                used.add(key(names[index]!));
              }
            }
          };

          for (const [index, { file }] of pending.entries()) {
            const name = names[index]!;
            const started = performance.now();
            try {
              const result = await writeOne(index, file);
              const ms = Math.round(performance.now() - started);
              const final = names[index]!;
              written++;
              if (result.replaced) replaced++;
              if (final !== file.name) added++;
              if (result.leftover) leftovers.push(result.leftover);
              await record({ ...fields(file), to: pathOf(final), status: 'sent', ms, messageId: final !== file.name ? final : null });
            } catch (err) {
              const ms = Math.round(performance.now() - started);
              const why = reason(err);
              const inWay = taken(err);
              const message = inWay
                ? `${name} is already in ${folder}: another run or program wrote it after this run looked. It was not replaced. Change "When a file with the same name exists" or move the old file.`
                : why.message;
              const detail = inWay ? (why.detail ?? why.message) : why.detail;
              failures.push({ message: inWay ? message : `${file.name}: ${message}`, detail });
              await record({ ...fields(file), to: pathOf(names[index]!), status: 'failed', ms, error: message, detail: detail ?? null });
              if (stops(err)) {
                for (const { file: other } of pending.slice(index + 1)) failures.push({ message: `${other.name}: ${notWritten(why.message)}` });
                await stopAll(index + 1, why);
                break;
              }
            }
          }
        }
      } finally {
        await release();
      }

      const where = `${folder} on ${host}`;
      const already = sentIn.size;
      if (failures.length > 0) throw deliveryFailed(`Wrote ${written + already} of ${nFiles(files.length)} to ${where}`, failures, 'Files written');
      const extra = [replaced > 0 ? `${replaced} replaced` : '', added > 0 ? `${added} with a number added` : ''].filter(Boolean).join(', ');
      const before = earlierText(already, sentIn.values(), 'written');
      const left =
        leftovers.length === 0
          ? ''
          : `. ${leftovers.length === 1 ? `The replaced file was kept as ${leftovers[0]}` : `${leftovers.length} replaced files were kept, such as ${leftovers[0]}`}, since it could not be deleted. Delete ${leftovers.length === 1 ? 'it' : 'them'}`;
      return `Wrote ${nFiles(written)} to ${where}${extra ? ` (${extra})` : ''}${before}${keepCopy ? ', a copy kept in Spooldoc' : ''}${left}`;
    },
  };
}
