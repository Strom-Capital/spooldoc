import { ConnectionError, type ConnectionErrorCode, type IfsWriteOptions, type IfsWriteResult } from "../connection.js";

/**
 * The IFS calls a write needs: jt400's `IFSFile` in production, an in-memory folder in the
 * tests. A call that fails may return false or throw; both mean it did not happen.
 */
export interface IfsFileOps {
  exists(path: string): Promise<boolean>;
  /** Creates a new file with these bytes, tagged with `ccsid`. */
  write(path: string, bytes: Uint8Array, ccsid: number): Promise<void>;
  /** Renames a file. It does not replace a file at `to`. */
  rename(from: string, to: string): Promise<boolean>;
  delete(path: string): Promise<boolean>;
}

/** How many times a write looks again when another write changes the file under it. */
const TRIES = 3;

/** The longest name of one IFS path component. */
const MAX_NAME = 255;

/** Eight random hex characters, so two writes of one name never share a temporary file. */
export function writeToken(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The name of a temporary file next to `name`: `.invoice-1001.pdf.1a2b3c4d.part`. It starts
 * with a dot and ends in `.part` or `.old`, so a program that watches for `*.pdf` skips it.
 * A long name is cut, so the whole stays within the 255 characters of an IFS name.
 */
export function tempName(name: string, token: string, kind: "part" | "old"): string {
  const room = MAX_NAME - `.${token}.${kind}`.length - 1;
  return `.${name.slice(0, room)}.${token}.${kind}`;
}

function split(path: string): { folder: string; name: string } {
  const at = path.lastIndexOf("/");
  return { folder: at > 0 ? path.slice(0, at) : "", name: path.slice(at + 1) };
}

/** The text of a failed call, kept as the detail of the error that reports it. */
function textOf(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  const e = err as { detail?: unknown; message?: unknown };
  if (typeof e.detail === "string") return e.detail;
  if (typeof e.message === "string") return e.message;
  return String(err);
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Writes a file to the IFS so that no file is lost and none is replaced by surprise:
 *
 * 1. The bytes go to a temporary file of this write only, `.name.<token>.part`.
 * 2. When nothing has the name, the part file is renamed to it.
 * 3. When a file has the name and `ifExists` is "replace", the old file is renamed aside
 *    to `.name.<token>.old`, the part file is renamed into place, and the old file is
 *    deleted. If the part file cannot be renamed, the old file is renamed back.
 * 4. When a file has the name and `ifExists` is "fail", nothing is replaced: the part
 *    file is deleted and the error has code "exists".
 *
 * Only this write's own temporary files are deleted. When a step fails so that the old
 * file cannot be put back, both files are kept, and the error says where each one is.
 */
export async function writeIfsFileSafely(
  ops: IfsFileOps,
  path: string,
  bytes: Uint8Array,
  { ccsid, ifExists = "replace" }: IfsWriteOptions,
  token: string = writeToken(),
): Promise<IfsWriteResult> {
  const { folder, name } = split(path);
  const where = folder || "/";
  const part = `${folder}/${tempName(name, token, "part")}`;
  const backup = `${folder}/${tempName(name, token, "old")}`;
  let lastError: unknown;

  const attempt = async (call: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await call();
    } catch (err) {
      lastError = err;
      return false;
    }
  };
  const rename = (from: string, to: string) => attempt(() => ops.rename(from, to));
  const exists = (file: string) => attempt(() => ops.exists(file));

  /** Deletes this write's part file; true when it is gone. */
  const removePart = async (): Promise<boolean> => {
    try {
      if (await ops.delete(part)) return true;
    } catch {
      // Looked at below.
    }
    try {
      return !(await ops.exists(part));
    } catch {
      return false;
    }
  };

  /**
   * The error to throw, after the part file is deleted. A `ConnectionError` it is about
   * keeps its code and IBM i text; any other failed call is kept as the detail.
   */
  const failure = async (code: ConnectionErrorCode, message: string, err: unknown = lastError): Promise<ConnectionError> => {
    const note = (await removePart()) ? "" : ` The part file ${part} could not be deleted. Delete it.`;
    const known = err instanceof ConnectionError ? err : undefined;
    return new ConnectionError(known?.code ?? code, `${message}${note}`, {
      messageId: known?.messageId,
      detail: known?.detail ?? textOf(err),
    });
  };

  try {
    await ops.write(part, bytes, ccsid);
  } catch (err) {
    throw await failure("other", messageOf(err), err);
  }

  // A file can appear or go between a look and a rename, when another run writes the
  // same name at the same time, so each step is tried again a few times.
  for (let tries = 0; tries < TRIES; tries++) {
    let there: boolean;
    try {
      there = await ops.exists(path);
    } catch (err) {
      throw await failure("other", messageOf(err), err);
    }

    if (!there) {
      if (await rename(part, path)) return { replaced: false };
      // The rename does not replace, so a file that is there now came from another write.
      if (await exists(path)) continue;
      throw await failure("other", `The new file ${part} could not be renamed to ${path}. Nothing was replaced. Check that the user profile can rename files in ${where}.`);
    }

    if (ifExists === "fail") throw await failure("exists", `${name} is already in ${where}. It was not replaced.`, null);

    if (!(await rename(path, backup))) {
      // Another write may be replacing it just now: look again.
      if (tries < TRIES - 1) continue;
      throw await failure(
        "other",
        `${path} could not be renamed to ${backup} to replace it. The old file is unchanged. Check that no job has it open and that the user profile can rename it.`,
      );
    }

    if (!(await rename(part, path))) {
      const cause = lastError;
      if (await rename(backup, path)) {
        throw await failure("other", `The new file could not be renamed to ${path}. The old file is back in place, unchanged.`, cause);
      }
      // Both files are kept: the part file is the only copy of the new bytes on the IBM i.
      throw new ConnectionError(
        "other",
        `The new file could not be renamed to ${path}, and the old file could not be put back. The old file is now ${backup} and the new one ${part}. Rename the one to keep to ${name}.`,
        { detail: textOf(cause) },
      );
    }

    if (!(await attempt(() => ops.delete(backup)))) return { replaced: true, leftover: backup };
    return { replaced: true };
  }
  throw await failure("other", `${path} kept changing while it was written, as if another run writes the same name. Nothing was replaced. Try again.`);
}
