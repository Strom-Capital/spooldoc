import { describe, expect, it } from "vitest";
import { ConnectionError } from "../src/index.js";
import { tempName, writeIfsFileSafely, writeToken, type IfsFileOps } from "../src/jt400/ifs-write.js";

const FOLDER = "/home/docs/out";
const OLD = new Uint8Array([1]);
const NEW = new Uint8Array([2, 2]);

/**
 * An IFS folder in memory that ignores case, as the IFS does outside /QOpenSys. A rename
 * never replaces, as jt400's `renameTo`. `fail` makes one call fail; `before` runs just
 * before a call, as another run would.
 */
function folder(files: Record<string, Uint8Array> = {}) {
  const ifs = new Map<string, Uint8Array>(Object.entries(files).map(([name, bytes]) => [`${FOLDER}/${name}`, bytes]));
  const find = (path: string) => [...ifs.keys()].find((key) => key.toLowerCase() === path.toLowerCase());
  const log: string[] = [];
  const fail = new Set<string>();
  const before = new Map<string, () => void>();
  const step = (call: string) => {
    log.push(call);
    before.get(call)?.();
    before.delete(call);
    return fail.has(call);
  };
  const short = (path: string) => path.slice(FOLDER.length + 1);
  const ops: IfsFileOps = {
    async exists(path) {
      step(`exists ${short(path)}`);
      return find(path) !== undefined;
    },
    async write(path, bytes) {
      if (step(`write ${short(path)}`)) throw new ConnectionError("authority", "DEMOUSER needs *WX authority.");
      ifs.set(path, bytes);
    },
    async rename(from, to) {
      if (step(`rename ${short(from)} ${short(to)}`)) return false;
      const key = find(from);
      if (key === undefined || find(to) !== undefined) return false;
      ifs.set(to, ifs.get(key)!);
      ifs.delete(key);
      return true;
    },
    async delete(path) {
      if (step(`delete ${short(path)}`)) return false;
      const key = find(path);
      return key !== undefined && ifs.delete(key);
    },
  };
  const names = () => [...ifs.keys()].map(short).sort();
  const at = (name: string) => ifs.get(`${FOLDER}/${name}`);
  return { ops, ifs, log, fail, before, names, at };
}

const T = "0a0b0c0d";
const PART = `.invoice-1001.pdf.${T}.part`;
const BACKUP = `.invoice-1001.pdf.${T}.old`;
const write = (f: ReturnType<typeof folder>, ifExists: "replace" | "fail" = "replace", token = T) =>
  writeIfsFileSafely(f.ops, `${FOLDER}/invoice-1001.pdf`, NEW, { ccsid: 65535, ifExists }, token);

describe("writeIfsFileSafely", () => {
  it("writes a part file of its own and renames it into place", async () => {
    const f = folder();
    expect(await write(f)).toEqual({ replaced: false });
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(NEW);
    expect(f.log).toEqual([`write ${PART}`, "exists invoice-1001.pdf", `rename ${PART} invoice-1001.pdf`]);
  });

  it("replaces by moving the old file aside, renaming the new one in, then deleting the old one", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    expect(await write(f)).toEqual({ replaced: true });
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(NEW);
    expect(f.log.slice(2)).toEqual([`rename invoice-1001.pdf ${BACKUP}`, `rename ${PART} invoice-1001.pdf`, `delete ${BACKUP}`]);
  });

  it("puts the old file back when the new one cannot be renamed into place", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    f.fail.add(`rename ${PART} invoice-1001.pdf`);
    await expect(write(f)).rejects.toThrow(`The new file could not be renamed to ${FOLDER}/invoice-1001.pdf. The old file is back in place, unchanged.`);
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(OLD);
  });

  it("keeps both files and says where they are when the old one cannot be put back either", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    f.fail.add(`rename ${PART} invoice-1001.pdf`);
    f.fail.add(`rename ${BACKUP} invoice-1001.pdf`);
    await expect(write(f)).rejects.toThrow(
      `The new file could not be renamed to ${FOLDER}/invoice-1001.pdf, and the old file could not be put back. The old file is now ${FOLDER}/${BACKUP} and the new one ${FOLDER}/${PART}. Rename the one to keep to invoice-1001.pdf.`,
    );
    expect(f.at(BACKUP)).toEqual(OLD);
    expect(f.at(PART)).toEqual(NEW);
  });

  it("leaves the old file alone when it cannot be moved aside", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    f.fail.add(`rename invoice-1001.pdf ${BACKUP}`);
    await expect(write(f)).rejects.toThrow(/could not be renamed to .* to replace it\. The old file is unchanged\./);
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(OLD);
  });

  it("reports an old file it could not delete after the new one is in place", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    f.fail.add(`delete ${BACKUP}`);
    expect(await write(f)).toEqual({ replaced: true, leftover: `${FOLDER}/${BACKUP}` });
    expect(f.at("invoice-1001.pdf")).toEqual(NEW);
  });

  it("never replaces in fail mode, even with a file that appears between the look and the rename", async () => {
    const f = folder();
    f.before.set(`rename ${PART} invoice-1001.pdf`, () => f.ifs.set(`${FOLDER}/invoice-1001.pdf`, OLD));
    const err = await write(f, "fail").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).code).toBe("exists");
    expect((err as ConnectionError).message).toBe(`invoice-1001.pdf is already in ${FOLDER}. It was not replaced.`);
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(OLD);
  });

  it("fails in fail mode for a name that differs only in case", async () => {
    const f = folder({ "INVOICE-1001.PDF": OLD });
    await expect(write(f, "fail")).rejects.toMatchObject({ code: "exists" });
    expect(f.names()).toEqual(["INVOICE-1001.PDF"]);
  });

  it("replaces a file that appears between the look and the rename in replace mode", async () => {
    const f = folder();
    f.before.set(`rename ${PART} invoice-1001.pdf`, () => f.ifs.set(`${FOLDER}/invoice-1001.pdf`, OLD));
    expect(await write(f)).toEqual({ replaced: true });
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect(f.at("invoice-1001.pdf")).toEqual(NEW);
  });

  it("gives two writes of one name their own part files, and the second does not touch the first's", async () => {
    const f = folder();
    const other = `.invoice-1001.pdf.ffffffff.part`;
    // Another run is part way through its write when this one starts.
    f.ifs.set(`${FOLDER}/${other}`, OLD);
    await write(f);
    expect(f.at(other)).toEqual(OLD);
    expect(f.log.some((call) => call.includes(other))).toBe(false);
  });

  it("lets the last of two writes to one name win, and loses no other file", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    const first = writeIfsFileSafely(f.ops, `${FOLDER}/invoice-1001.pdf`, new Uint8Array([3]), { ccsid: 65535 }, "11111111");
    const second = writeIfsFileSafely(f.ops, `${FOLDER}/invoice-1001.pdf`, NEW, { ccsid: 65535 }, "22222222");
    const results = await Promise.all([first, second]);
    expect(results.every((r) => r.replaced)).toBe(true);
    expect(f.names()).toEqual(["invoice-1001.pdf"]);
    expect([new Uint8Array([3]), NEW]).toContainEqual(f.at("invoice-1001.pdf"));
  });

  it("deletes its part file when the write fails, and keeps the error's code", async () => {
    const f = folder();
    f.fail.add(`write ${PART}`);
    await expect(write(f)).rejects.toMatchObject({ code: "authority", message: "DEMOUSER needs *WX authority." });
    expect(f.names()).toEqual([]);
  });

  it("says so when its part file cannot be deleted", async () => {
    const f = folder({ "invoice-1001.pdf": OLD });
    f.fail.add(`delete ${PART}`);
    await expect(write(f, "fail")).rejects.toThrow(`It was not replaced. The part file ${FOLDER}/${PART} could not be deleted. Delete it.`);
  });

  it("names temporary files within the 255 characters of an IFS name", () => {
    const token = writeToken();
    expect(token).toMatch(/^[0-9a-f]{8}$/);
    expect(writeToken()).not.toBe(token);
    expect(tempName("a.pdf", token, "part")).toBe(`.a.pdf.${token}.part`);
    expect(tempName(`${"x".repeat(300)}.pdf`, token, "old")).toHaveLength(255);
  });
});
