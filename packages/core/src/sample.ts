import { z } from "zod";

/** Identifies a spooled file on the system. */
export const spooledFileIdSchema = z.object({
  name: z.string().min(1),
  number: z.number().int().nonnegative(),
  jobName: z.string(),
  jobUser: z.string(),
  jobNumber: z.string(),
});
export type SpooledFileId = z.infer<typeof spooledFileIdSchema>;

/** Spooled file attributes captured with a sample. */
export const spooledFileAttributesSchema = z.object({
  queue: z.object({ library: z.string(), name: z.string() }),
  userData: z.string(),
  formType: z.string(),
  deviceType: z.string(),
  pages: z.number().int().nonnegative(),
  pageWidth: z.number().int().positive(),
  pageLength: z.number().int().positive(),
  cpi: z.number().nonnegative(),
  lpi: z.number().nonnegative(),
  chrid: z.object({ charset: z.number().int(), codePage: z.number().int() }).nullable(),
  jobCcsid: z.number().int().nullable(),
  created: z.string(),
});
export type SpooledFileAttributes = z.infer<typeof spooledFileAttributesSchema>;

/** One printed line: its 1-based line number on the page and its text. */
export const sampleLineSchema = z.object({
  no: z.number().int().positive(),
  text: z.string(),
});
export type SampleLine = z.infer<typeof sampleLineSchema>;

/** One page. `lines` is sparse: only printed lines, with exact 1-based line numbers. */
export const samplePageSchema = z.object({
  no: z.number().int().positive(),
  lines: z.array(sampleLineSchema),
});
export type SamplePage = z.infer<typeof samplePageSchema>;

/** A captured spooled file as stored in the workspace. */
export const sampleSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  version: z.literal(1),
  capturedAt: z.string(),
  system: z.string(),
  splf: spooledFileIdSchema,
  attributes: spooledFileAttributesSchema,
  codePage: z.number().int(),
  rawBase64: z.string(),
  pages: z.array(samplePageSchema),
  definition: z.string().optional(),
});
export type Sample = z.infer<typeof sampleSchema>;

const safe = (s: string): string => s.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "_";

/** A filesystem-safe sample id such as `SPDINVOICE-000123-000456` (name, job number, file number). */
export function sampleId(splf: SpooledFileId): string {
  return `${safe(splf.name)}-${safe(splf.jobNumber)}-${String(splf.number).padStart(6, "0")}`;
}

/** Placeholder values written by `scrubSample`. */
export const SCRUBBED = {
  jobUser: "DEMOUSER",
  jobNumber: "000000",
  system: "ibmi.example.com",
  library: "MYLIB",
} as const;

/**
 * Removes system-specific identifiers from a sample: job user, job number, system name
 * and output queue library. The id is rebuilt from the scrubbed values. Everything else,
 * including the raw bytes and pages, is kept.
 */
export function scrubSample(sample: Sample): Sample {
  const splf = { ...sample.splf, jobUser: SCRUBBED.jobUser, jobNumber: SCRUBBED.jobNumber };
  return {
    ...sample,
    id: sampleId(splf),
    system: SCRUBBED.system,
    splf,
    attributes: {
      ...sample.attributes,
      queue: { ...sample.attributes.queue, library: SCRUBBED.library },
    },
  };
}

/** Dense text of a page: blank lines filled in, every line padded to `width`. */
export function pageText(page: SamplePage, width: number): string {
  const last = page.lines.reduce((m, l) => Math.max(m, l.no), 0);
  const byNo = new Map(page.lines.map((l) => [l.no, l.text]));
  const out: string[] = [];
  for (let n = 1; n <= last; n++) out.push((byNo.get(n) ?? "").padEnd(width, " "));
  return out.join("\n");
}

/** The text of one line of a page, or an empty string when nothing was printed there. */
export function lineText(page: SamplePage, no: number): string {
  return page.lines.find((l) => l.no === no)?.text ?? "";
}
