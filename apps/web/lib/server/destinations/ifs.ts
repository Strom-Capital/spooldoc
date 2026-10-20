import 'server-only';

import type { IfsConfig } from '@/lib/destination-config';
import { StepError } from '../step-error';
import type { Destination } from './index';
import { nFiles, storeRunFiles } from './store';

/** The CCSID a file is tagged with: UTF-8 for text such as HTML, binary for PDF, DOCX and XLSX. */
export function ccsidFor(contentType: string): number {
  return /^text\/|[/+](json|xml)\b/.test(contentType) ? 1208 : 65535;
}

/** `invoice-1001.pdf` with a number: `invoice-1001-2.pdf`. */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

const reason = (err: unknown): { message: string; detail?: string } => {
  const message = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
  const detail = err instanceof Error && 'detail' in err && typeof err.detail === 'string' ? err.detail : undefined;
  return { message, detail };
};

/**
 * Writes each file of a run to a folder in the IFS of the job's server. Spooldoc never
 * creates the folder. With `keepCopy`, the files are kept in Spooldoc first, so they can
 * be downloaded even when the write fails.
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

      // The name each file gets. Every name is checked before anything is written.
      const names: string[] = [];
      let renamed = 0;
      if (ifExists === 'fail') {
        const taken: string[] = [];
        for (const file of files) {
          if ((await conn.ifsStat(pathOf(file.name))) !== null) taken.push(file.name);
        }
        if (taken.length > 0) {
          const more = taken.length > 1 ? ` and ${nFiles(taken.length - 1)} more are` : ' is';
          throw new StepError(
            'deliver',
            `${taken[0]}${more} already in ${folder}. Nothing was written. Change "When a file with the same name exists" or move the old ${taken.length > 1 ? 'files' : 'file'}.`,
          );
        }
        names.push(...files.map((file) => file.name));
      } else if (ifExists === 'suffix') {
        // A new name must not be one of this run's other files either.
        const used = new Set(files.map((file) => file.name));
        const free = async (name: string) => !used.has(name) && (await conn.ifsStat(pathOf(name))) === null;
        for (const file of files) {
          let name = file.name;
          if ((await conn.ifsStat(pathOf(name))) !== null) {
            let n = 2;
            while (!(await free(numbered(file.name, n)))) n++;
            name = numbered(file.name, n);
            used.add(name);
            renamed++;
          }
          names.push(name);
        }
      } else {
        names.push(...files.map((file) => file.name));
      }

      let replaced = 0;
      for (const [index, file] of files.entries()) {
        try {
          const written = await conn.writeIfsFile(pathOf(names[index]!), file.content, { ccsid: ccsidFor(file.contentType) });
          if (written.replaced) replaced++;
        } catch (err) {
          const { message, detail } = reason(err);
          throw new StepError('deliver', index === 0 ? message : `Wrote ${index} of ${nFiles(files.length)} to ${folder}, then: ${message}`, detail);
        }
      }

      const extra = [replaced > 0 ? `${replaced} replaced` : '', renamed > 0 ? `${renamed} with a number added` : ''].filter(Boolean).join(', ');
      return `Wrote ${nFiles(files.length)} to ${folder} on ${host}${extra ? ` (${extra})` : ''}${keepCopy ? ', a copy kept in Spooldoc' : ''}`;
    },
  };
}
