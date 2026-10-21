import 'server-only';

import type { IfsWriteOptions, IfsWriteResult } from '@spooldoc/ibmi';
import type { IfsConfig } from '@/lib/destination-config';
import { isConnectionError } from '../ibmi';
import { StepError } from '../step-error';
import type { Destination } from './index';
import { nFiles, storeRunFiles, type RunFile } from './store';

/** The CCSID a file is tagged with: UTF-8 for text such as HTML, binary for PDF, DOCX and XLSX. */
export function ccsidFor(contentType: string): number {
  return /^text\/|[/+](json|xml)\b/.test(contentType) ? 1208 : 65535;
}

/** `invoice-1001.pdf` with a number: `invoice-1001-2.pdf`. */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

/**
 * A name as the IFS compares it. Folders outside /QOpenSys ignore case, so `Acme.pdf` and
 * `ACME.pdf` are one file. Names are compared this way in every folder: in a folder that
 * minds case, the cost is a number that was not needed, never a lost file.
 */
const key = (name: string): string => name.toLowerCase();

/** How many times Add a number tries the next number when a name is taken as it writes. */
const SUFFIX_TRIES = 10;

const reason = (err: unknown): { message: string; detail?: string } => {
  const message = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
  const detail = err instanceof Error && 'detail' in err && typeof err.detail === 'string' ? err.detail : undefined;
  return { message, detail };
};

const taken = (err: unknown): boolean => isConnectionError(err) && err.code === 'exists';

/**
 * The name each file of a run gets in the folder, before the folder is looked at. Two
 * names that differ only in case would be one file in the IFS, so the later one gets the
 * first number that no file of the run has. Spooldoc's own names stay as they are: only
 * the IFS ignores case.
 */
function ownNames(files: RunFile[]): string[] {
  const all = new Set(files.map((file) => key(file.name)));
  const claimed = new Set<string>();
  return files.map((file) => {
    let name = file.name;
    if (claimed.has(key(name))) {
      let n = 2;
      while (all.has(key(numbered(file.name, n)))) n++;
      name = numbered(file.name, n);
      all.add(key(name));
    }
    claimed.add(key(name));
    return name;
  });
}

/**
 * Writes each file of a run to a folder in the IFS of the job's server. Spooldoc never
 * creates the folder. With `keepCopy`, the files are kept in Spooldoc first, so they can
 * be downloaded even when the write fails.
 *
 * Every name is checked before anything is written, and checked again by the write, at
 * the moment the file is renamed into place: a file another run wrote in between is
 * replaced only with Replace.
 */
export function ifsDestination(config: IfsConfig): Destination {
  const { folder, ifExists, keepCopy } = config;
  const pathOf = (name: string) => `${folder}/${name}`;
  return {
    kind: 'ifs',
    async deliver({ runId, files, conn, host }) {
      if (keepCopy) {
        await storeRunFiles(runId, files);
      }
      const at = await conn.ifsStat(folder);
      if (at === 'file') {
        throw new StepError('deliver', `${folder} on ${host} is a file, not a folder. Change the destination's folder.`);
      }
      if (at === null) {
        throw new StepError('deliver', `The folder ${folder} does not exist on ${host}. Create it, or change the destination's folder.`);
      }

      const own = ownNames(files);
      const names = [...own];
      // Names taken, by this run or in the folder, compared as the IFS compares them.
      const used = new Set(names.map(key));
      const free = async (name: string) => !used.has(key(name)) && (await conn.ifsStat(pathOf(name))) === null;
      /** The first free number for a file, from `n` on. */
      const nextFree = async (name: string, n: number) => {
        while (!(await free(numbered(name, n)))) n++;
        return n;
      };

      if (ifExists === 'fail') {
        const inTheWay: string[] = [];
        for (const name of names) {
          if ((await conn.ifsStat(pathOf(name))) !== null) inTheWay.push(name);
        }
        if (inTheWay.length > 0) {
          const more = inTheWay.length > 1 ? ` and ${nFiles(inTheWay.length - 1)} more are` : ' is';
          throw new StepError(
            'deliver',
            `${inTheWay[0]}${more} already in ${folder}. Nothing was written. Change "When a file with the same name exists" or move the old ${inTheWay.length > 1 ? 'files' : 'file'}.`,
          );
        }
      } else if (ifExists === 'suffix') {
        for (const [index, name] of names.entries()) {
          if ((await conn.ifsStat(pathOf(name))) === null) continue;
          const numberedName = numbered(name, await nextFree(name, 2));
          used.add(key(numberedName));
          names[index] = numberedName;
        }
      }

      // Replace replaces at the moment of the rename. The other two never do: a name that
      // was taken in between fails the run, or, with Add a number, gets the next number.
      const options = (file: RunFile): IfsWriteOptions => ({ ccsid: ccsidFor(file.contentType), ifExists: ifExists === 'replace' ? 'replace' : 'fail' });

      const writeOne = async (index: number, file: RunFile): Promise<IfsWriteResult> => {
        for (let tries = 1; ; tries++) {
          try {
            return await conn.writeIfsFile(pathOf(names[index]!), file.content, options(file));
          } catch (err) {
            if (ifExists !== 'suffix' || !taken(err) || tries >= SUFFIX_TRIES) throw err;
            // Another run took the name since it was checked: take the next free number.
            names[index] = numbered(own[index]!, await nextFree(own[index]!, 2));
            used.add(key(names[index]!));
          }
        }
      };

      let replaced = 0;
      const leftovers: string[] = [];
      for (const [index, file] of files.entries()) {
        const before = index === 0 ? '' : `Wrote ${index} of ${nFiles(files.length)} to ${folder}, then: `;
        try {
          const written = await writeOne(index, file);
          if (written.replaced) replaced++;
          if (written.leftover) leftovers.push(written.leftover);
        } catch (err) {
          const { message, detail } = reason(err);
          if (taken(err)) {
            throw new StepError(
              'deliver',
              `${before}${names[index]} is already in ${folder}: another run or program wrote it after this run looked. It was not replaced. Change "When a file with the same name exists" or move the old file.`,
              detail ?? message,
            );
          }
          throw new StepError('deliver', `${before}${message}`, detail);
        }
      }

      const added = names.filter((name, index) => name !== files[index]!.name).length;
      const extra = [replaced > 0 ? `${replaced} replaced` : '', added > 0 ? `${added} with a number added` : ''].filter(Boolean).join(', ');
      const left =
        leftovers.length === 0
          ? ''
          : `. ${leftovers.length === 1 ? `The replaced file was kept as ${leftovers[0]}` : `${leftovers.length} replaced files were kept, such as ${leftovers[0]}`}, since it could not be deleted. Delete ${leftovers.length === 1 ? 'it' : 'them'}`;
      return `Wrote ${nFiles(files.length)} to ${folder} on ${host}${extra ? ` (${extra})` : ''}${keepCopy ? ', a copy kept in Spooldoc' : ''}${left}`;
    },
  };
}
