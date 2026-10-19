import { convertNunjucks } from '@spooldoc/core/convert';
import { z } from 'zod';

/** An IBM i object name: 1 to 10 characters, upper-cased. */
export const IBMI_NAME = /^[A-Z$#@][A-Z0-9_$#@.]{0,9}$/;

/** Upper-cases and checks an IBM i object name such as a library or queue. */
export const ibmiName = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(IBMI_NAME, 'Use an IBM i name: up to 10 letters, digits or _ $ # @'));

export const queueRefSchema = z.object({ library: ibmiName, name: ibmiName });
export type QueueRefSpec = z.infer<typeof queueRefSchema>;

/** The files a job makes from each document. */
export const OUTPUT_FORMATS = ['pdf', 'html'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Which spooled files of the queue a job takes. Each is a "contains" match; empty means any. */
const sourceFilterSchema = z.object({
  splf: z.string().max(10).default(''),
  userData: z.string().max(10).default(''),
  jobName: z.string().max(10).default(''),
  jobUser: z.string().max(10).default(''),
  formType: z.string().max(10).default(''),
});
export type SourceFilter = z.infer<typeof sourceFilterSchema>;
const EMPTY_FILTER: SourceFilter = { splf: '', userData: '', jobName: '', jobUser: '', formType: '' };

/** A job's filters as the files API's query parameters. */
export function filterParams(filter: SourceFilter, params = new URLSearchParams()): URLSearchParams {
  const add = (key: string, value: string) => value.trim() && params.set(key, value.trim());
  add('name', filter.splf);
  add('userData', filter.userData);
  add('jobName', filter.jobName);
  add('jobUser', filter.jobUser);
  add('formType', filter.formType);
  return params;
}

/** The spooled file statuses the watcher takes for a trigger. */
export function watchedStatuses(trigger: { includeHeld: boolean }): string[] {
  return trigger.includeHeld ? ['READY', 'HELD'] : ['READY'];
}

/** A job's filters as the IBM i spooled file filter. */
export function ibmiFilter(filter: SourceFilter): { name?: string; userData?: string; jobName?: string; jobUser?: string; formType?: string } {
  const value = (text: string) => text.trim() || undefined;
  return { name: value(filter.splf), userData: value(filter.userData), jobName: value(filter.jobName), jobUser: value(filter.jobUser), formType: value(filter.formType) };
}

/** An output's id: lowercase letters, digits and dashes. */
export const OUTPUT_ID = /^[a-z0-9-]{1,40}$/;

/** One set of files a job makes from each document: a template and the formats it renders to. */
const outputSchema = z.object({
  id: z.string().regex(OUTPUT_ID, 'Use lowercase letters, digits and dashes for an output id'),
  label: z.string().trim().min(1, 'Name the output').max(40, 'Use at most 40 characters for an output name'),
  /**
   * `source: null` is the starter template generated from the definition. A Nunjucks
   * template from before Carbone is converted to Carbone tags when it is read.
   */
  template: z.object({
    kind: z.literal('html'),
    source: z
      .string()
      .max(500_000)
      .nullable()
      .default(null)
      .transform((source) => (source === null ? null : convertNunjucks(source))),
  }),
  formats: z
    .array(z.enum(OUTPUT_FORMATS))
    .min(1, 'Pick at least one format')
    .transform((formats) => OUTPUT_FORMATS.filter((f) => formats.includes(f))),
});
export type JobOutput = z.infer<typeof outputSchema>;

/** The output of a new job, and of a job saved before a job had several. */
function firstOutput(): JobOutput {
  return { id: 'main', label: 'Document', template: { kind: 'html', source: null }, formats: ['pdf'] };
}

/**
 * A render part saved before outputs, `{ template, formats }` or the older `{ template, format }`,
 * as one output. Anything else is left to the schema.
 */
function migrateRender(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || 'outputs' in value) {
    return value;
  }
  const old = value as { template?: unknown; formats?: unknown; format?: unknown };
  const formats = old.formats ?? (old.format === undefined ? ['pdf'] : [old.format]);
  return { outputs: [{ ...firstOutput(), template: { kind: 'html', source: old.template ?? null }, formats }] };
}

/**
 * The output with this id, or else this label (any case); the first output when `key` is not given.
 * Null when there is no such output.
 */
export function findOutput(outputs: JobOutput[], key?: string | null): JobOutput | null {
  if (key === undefined || key === null) {
    return outputs[0] ?? null;
  }
  const label = key.trim().toLowerCase();
  return outputs.find((output) => output.id === key) ?? outputs.find((output) => output.label.toLowerCase() === label) ?? null;
}

/** An output's label as part of a file name: "Order lines" is `order-lines`. Its id when nothing is left. */
export function outputSlug(output: Pick<JobOutput, 'id' | 'label'>): string {
  const slug = output.label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || output.id;
}

/**
 * A document's file name (without extension) for one output: the first output's files keep
 * the document's name, the others add their label, as in `invoice-260101-lines`.
 */
export function outputFileName(documentName: string, outputs: Pick<JobOutput, 'id'>[], output: Pick<JobOutput, 'id' | 'label'>): string {
  return outputs[0]?.id === output.id ? documentName : `${documentName}-${outputSlug(output)}`;
}

/** True when another output than `except` already has this label (any case). */
export function labelTaken(outputs: JobOutput[], label: string, except?: string): boolean {
  const wanted = label.trim().toLowerCase();
  return outputs.some((output) => output.id !== except && output.label.toLowerCase() === wanted);
}

/**
 * A new output for a job that has `outputs`: the label given, or "Output 2" and so on,
 * an id made from the label that no other output has, the starter template and PDF.
 */
export function newOutput(outputs: JobOutput[], label?: string, formats: OutputFormat[] = ['pdf']): JobOutput {
  let name = label?.trim();
  if (!name) {
    let n = outputs.length + 1;
    while (labelTaken(outputs, `Output ${n}`)) n++;
    name = `Output ${n}`;
  }
  const base = outputSlug({ id: 'output', label: name });
  let id = base;
  for (let n = 2; outputs.some((output) => output.id === id); n++) id = `${base.slice(0, 36)}-${n}`;
  return { id, label: name, template: { kind: 'html', source: null }, formats: OUTPUT_FORMATS.filter((f) => formats.includes(f)) };
}

/** What happens to a spooled file after every document was delivered. */
export const FINISH_ACTIONS = ['hold', 'move', 'delete', 'none'] as const;
export type FinishAction = (typeof FINISH_ACTIONS)[number];

/** The parts of a job. A draft may be incomplete; a version must be complete (`completeSpec`). */
export const jobSpecSchema = z.object({
  source: z
    .object({
      serverId: z.string().uuid().nullable().default(null),
      library: z.string().default(''),
      queue: z.string().default(''),
      filter: sourceFilterSchema.default(EMPTY_FILTER),
    })
    .default({ serverId: null, library: '', queue: '', filter: EMPTY_FILTER }),
  trigger: z
    .object({
      mode: z.enum(['manual', 'watch']).default('manual'),
      /** When watching starts, also run the files already ready on the queue (else they are left for Run now). */
      backlog: z.boolean().default(false),
      /** The watcher also takes held files, not only ready ones. */
      includeHeld: z.boolean().default(false),
    })
    .default({ mode: 'manual', backlog: false, includeHeld: false }),
  extract: z.object({ definition: z.string().max(200_000).default('') }).default({ definition: '' }),
  render: z
    .preprocess(migrateRender, z.object({ outputs: z.array(outputSchema).min(1, 'Add at least one output') }))
    .default(() => ({ outputs: [firstOutput()] })),
  destination: z.object({ destinationId: z.string().uuid().nullable().default(null) }).default({ destinationId: null }),
  finish: z
    .object({ action: z.enum(FINISH_ACTIONS).default('hold'), queue: queueRefSchema.nullable().default(null) })
    .default({ action: 'hold', queue: null }),
  /** The spooled file shown while designing. Only in drafts. */
  preview: z.object({ sampleId: z.string().uuid().nullable().default(null) }).default({ sampleId: null }),
});
export type JobSpec = z.infer<typeof jobSpecSchema>;

/** An empty draft. */
export function emptySpec(overrides: { serverId?: string; library?: string; queue?: string; destinationId?: string } = {}): JobSpec {
  const spec = jobSpecSchema.parse({});
  return {
    ...spec,
    source: { ...spec.source, serverId: overrides.serverId ?? null, library: overrides.library ?? '', queue: overrides.queue ?? '' },
    destination: { destinationId: overrides.destinationId ?? null },
  };
}

/**
 * What still has to be set before a spec can be saved as a version, one line per part.
 * Parsing the definition is up to the server.
 */
export function missingParts(spec: JobSpec): string[] {
  const missing: string[] = [];
  if (!spec.source.serverId || !spec.source.library || !spec.source.queue) missing.push('Source: pick a server and an output queue.');
  if (!spec.extract.definition.trim()) missing.push('Extract: write a definition.');
  const outputs = spec.render.outputs;
  const twice = new Set<string>();
  for (const [index, output] of outputs.entries()) {
    if (outputs.findIndex((other) => other.id === output.id) < index) {
      twice.add(`Render: two outputs have the id "${output.id}". Give each output its own id.`);
    } else if (labelTaken(outputs.slice(0, index), output.label)) {
      twice.add(`Render: two outputs are named "${output.label}". Give each output its own name.`);
    }
  }
  missing.push(...twice);
  if (!spec.destination.destinationId) missing.push('Destination: pick a destination.');
  if (spec.finish.action === 'move' && !spec.finish.queue) missing.push('Finish: pick the output queue to move files to.');
  return missing;
}

/**
 * True when making `next` active would start deleting spooled files: it deletes and the
 * active version (null when there is none) does not. That needs the user's confirmation.
 */
export function startsDeleting(next: JobSpec, active: JobSpec | null): boolean {
  return next.finish.action === 'delete' && active?.finish.action !== 'delete';
}

/** What the user confirms before a version starts deleting the spooled files of a queue. */
export function deleteNotice(spec: Pick<JobSpec, 'source'>): string {
  return `Spooled files on ${spec.source.library}/${spec.source.queue} will be deleted from the IBM i after their documents are delivered.`;
}

/** A spec as stored in a version: the preview sample is dropped. */
export function versionSpec(spec: JobSpec): JobSpec {
  return { ...spec, preview: { sampleId: null } };
}

/** True when two specs differ in anything a version keeps. */
export function specsDiffer(a: JobSpec, b: JobSpec): boolean {
  const normal = (spec: JobSpec): string => JSON.stringify(versionSpec(jobSpecSchema.parse(spec)));
  return normal(a) !== normal(b);
}

/** The key that identifies a spooled file on one system. */
export function splfKey(splf: { name: string; number: number; jobName: string; jobUser: string; jobNumber: string }): string {
  return `${splf.name}/${splf.number}/${splf.jobNumber}/${splf.jobUser}/${splf.jobName}`;
}

/** Some parts of a draft: each given part replaces the draft's part. */
export const draftPatchSchema = z.object({
  source: jobSpecSchema.shape.source.removeDefault().optional(),
  trigger: jobSpecSchema.shape.trigger.removeDefault().optional(),
  extract: jobSpecSchema.shape.extract.removeDefault().optional(),
  render: jobSpecSchema.shape.render.removeDefault().optional(),
  destination: jobSpecSchema.shape.destination.removeDefault().optional(),
  finish: jobSpecSchema.shape.finish.removeDefault().optional(),
  preview: jobSpecSchema.shape.preview.removeDefault().optional(),
});
export type DraftPatch = z.infer<typeof draftPatchSchema>;
