import {
  decoderFor,
  parseScs,
  resolveCodePage,
  sampleId,
  sampleSchema,
  type Sample,
  type SpooledFileId,
} from "@spooldoc/core";
import type { Connection } from "./connection.js";

/** Options for `captureSample`. */
export interface CaptureOptions {
  /** System name stored in the sample. Default: the host from `describe()`. */
  system: string;
  /** Code page to decode with when the file has no CHRID and the job CCSID is not supported. */
  fallbackCodePage?: number;
  /** Clock for `capturedAt`, for tests. */
  now?: () => Date;
}

/** A captured sample and anything worth telling the user about it. */
export interface CaptureResult {
  sample: Sample;
  warnings: string[];
}

/**
 * Reads a spooled file through `conn` and builds a `Sample`: the raw bytes as base64,
 * the attributes, the resolved code page and the pages parsed from the *SCS stream.
 * A file whose device type is not *SCS is still captured, with a warning.
 */
export async function captureSample(
  conn: Connection,
  id: SpooledFileId,
  options?: Partial<CaptureOptions>,
): Promise<CaptureResult> {
  const warnings: string[] = [];
  const { bytes, attributes: read } = await conn.readSpooledFile(id);
  let attributes = read;
  let system = options?.system;
  if (system === undefined || attributes.jobCcsid === null) {
    const info = await conn.describe();
    system ??= info.host;
    if (attributes.jobCcsid === null) attributes = { ...attributes, jobCcsid: info.jobCcsid };
  }

  const { codePage, source } = resolveCodePage(attributes, options?.fallbackCodePage);
  if (source === "job") warnings.push(`No CHRID on the spooled file; decoded with the job CCSID ${codePage}.`);
  if (source === "fallback") warnings.push(`No usable CHRID or job CCSID; decoded with the fallback code page ${codePage}.`);
  if (attributes.deviceType.toUpperCase() !== "*SCS") {
    warnings.push(`Device type is ${attributes.deviceType || "unknown"}, not *SCS; the pages may be incomplete or empty.`);
  }

  const { pages } = parseScs(bytes, decoderFor(codePage), { pageLength: attributes.pageLength });
  if (attributes.pages > 0 && pages.length !== attributes.pages) {
    warnings.push(`The system reports ${attributes.pages} pages; the *SCS stream gave ${pages.length}.`);
  }

  const now = (options?.now ?? (() => new Date()))();
  const sample = sampleSchema.parse({
    id: sampleId(id),
    version: 1,
    capturedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    system,
    splf: { name: id.name, number: id.number, jobName: id.jobName, jobUser: id.jobUser, jobNumber: id.jobNumber },
    attributes,
    codePage,
    rawBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
    pages,
  } satisfies Sample);
  return { sample, warnings };
}
