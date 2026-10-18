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
      filter: z
        .object({ splf: z.string().max(10).default(''), userData: z.string().max(10).default('') })
        .default({ splf: '', userData: '' }),
    })
    .default({ serverId: null, library: '', queue: '', filter: { splf: '', userData: '' } }),
  trigger: z.object({ mode: z.enum(['manual', 'watch']).default('manual') }).default({ mode: 'manual' }),
  extract: z.object({ definition: z.string().max(200_000).default('') }).default({ definition: '' }),
  render: z
    .object({ template: z.string().max(500_000).nullable().default(null), format: z.literal('pdf').default('pdf') })
    .default({ template: null, format: 'pdf' }),
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
  if (!spec.destination.destinationId) missing.push('Destination: pick a destination.');
  if (spec.finish.action === 'move' && !spec.finish.queue) missing.push('Finish: pick the output queue to move files to.');
  return missing;
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
