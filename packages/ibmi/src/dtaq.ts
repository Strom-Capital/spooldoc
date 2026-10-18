import { decoderFor, type SpooledFileId } from "@spooldoc/core";
import type { QueueRef } from "./connection.js";

/** A "spooled file ready" entry that an output queue sends to its data queue. */
export interface SpooledFileEntryNotice {
  splf: SpooledFileId;
  queue: QueueRef;
}

/** The smallest entry the system writes (record type 01). */
export const SPOOLED_FILE_ENTRY_LENGTH = 128;

/** CRTDTAQ length that fits every record type the system sends for spooled files. */
export const SPOOLED_FILE_DTAQ_MAXLEN = 256;

const text = (decode: (bytes: Uint8Array) => string, bytes: Uint8Array, from: number, length: number): string =>
  decode(bytes.subarray(from, from + length)).trim();

/**
 * Parse a data queue entry from an output queue (`CHGOUTQ DTAQ(...)`). The layout of
 * record types 01 and 02 starts the same:
 *
 * | Offset | Length | Field |
 * |---|---|---|
 * | 0 | 10 | Function, `*SPOOL` |
 * | 10 | 2 | Record type, `01` or `02` |
 * | 12 | 26 | Qualified job: name, user, number |
 * | 38 | 10 | Spooled file name |
 * | 48 | 4 | Spooled file number, binary |
 * | 52 | 20 | Qualified output queue: name, library |
 *
 * @param bytes - The entry
 * @param codePage - EBCDIC code page for the names (the job CCSID); default 37
 * @returns The spooled file and its queue, or null for any other entry
 */
export function parseSpooledFileEntry(bytes: Uint8Array, codePage = 37): SpooledFileEntryNotice | null {
  if (bytes.length < 72) return null;
  let decode: (b: Uint8Array) => string;
  try {
    decode = decoderFor(codePage);
  } catch {
    decode = decoderFor(37);
  }
  const fn = text(decode, bytes, 0, 10);
  const type = text(decode, bytes, 10, 2);
  if (fn !== "*SPOOL" || (type !== "01" && type !== "02")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const splf: SpooledFileId = {
    jobName: text(decode, bytes, 12, 10),
    jobUser: text(decode, bytes, 22, 10),
    jobNumber: text(decode, bytes, 32, 6),
    name: text(decode, bytes, 38, 10),
    number: view.getInt32(48, false),
  };
  const queue = { name: text(decode, bytes, 52, 10), library: text(decode, bytes, 62, 10) };
  if (!splf.name || !queue.name || !queue.library || splf.number <= 0) return null;
  return { splf, queue };
}
