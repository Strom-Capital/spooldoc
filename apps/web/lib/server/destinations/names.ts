/**
 * The names a run's files get in a folder, shared by the IFS and SFTP destinations, so both
 * follow one case rule.
 */

/** `invoice-1001.pdf` with a number: `invoice-1001-2.pdf`. */
export function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

/**
 * A name as a folder that ignores case compares it. In the IFS, folders outside /QOpenSys
 * ignore case, so `Acme.pdf` and `ACME.pdf` are one file, and an SFTP server on Windows or
 * on the IBM i does the same. Names are compared this way in every folder: in a folder
 * that minds case, the cost is a number that was not needed, never a lost file.
 */
export const key = (name: string): string => name.toLowerCase();

/** How many times Add a number tries the next number when a name is taken as it writes. */
export const SUFFIX_TRIES = 10;

/**
 * The name each file of a run gets in the folder, before the folder is looked at. Two
 * names that differ only in case would be one file in a folder that ignores case, so the
 * later one gets the first number that no file of the run has. Spooldoc's own names stay
 * as they are.
 */
export function ownNames(files: readonly { name: string }[]): string[] {
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
