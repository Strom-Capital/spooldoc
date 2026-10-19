import 'server-only';

import type { Sample } from '@spooldoc/core';
import { z } from 'zod';
import { findOutput, jobSpecSchema, type JobOutput, type JobSpec, type OutputTemplate } from '@/lib/job-spec';
import { sampleTemplate } from './documents';
import type { JobRow } from './jobs';
import type { SampleTemplate } from './render';
import { getSample } from './samples';
import { TEMPLATE_FILE_GONE } from './template-files';

/** The draft of a job and its preview sample (null when none is picked or it is gone). */
export async function draftAndSample(job: JobRow, sampleId?: string): Promise<{ draft: JobSpec; sample: Sample | null }> {
  const draft = jobSpecSchema.parse(job.draft);
  const id = sampleId ?? draft.preview.sampleId;
  return { draft, sample: id ? await getSample(id) : null };
}

const MAX_TEXT = 2_000_000;

/** The template fields of a preview request: unsaved editor text, or a Word template, else the output's draft template. */
export const previewTemplateFields = {
  /** HTML; `null` means the starter template. */
  html: z.string().max(MAX_TEXT).nullable().optional(),
  /** A Word template; `fileId: null` means the Word starter template. */
  docx: z.object({ fileId: z.string().uuid().nullable() }).optional(),
  /** The output whose draft template is used when neither is given; missing means the first. */
  outputId: z.string().max(40).optional(),
};

/**
 * The template a preview renders: the one in the request, which wins so an output changed
 * a moment ago renders before its draft is saved, or else the output's draft template.
 * `output` is null when the request names no output the draft has.
 */
export async function previewTemplate(
  draft: JobSpec,
  input: { html?: string | null; docx?: { fileId: string | null }; outputId?: string },
): Promise<{ output: JobOutput | null; template: SampleTemplate } | { error: string; status: number }> {
  const output = findOutput(draft.render.outputs, input.outputId);
  let template: OutputTemplate;
  if (input.docx) {
    template = { kind: 'docx', fileId: input.docx.fileId };
  } else if (input.html !== undefined) {
    template = { kind: 'html', source: input.html };
  } else if (output) {
    template = output.template;
  } else {
    return { error: `The job has no output ${input.outputId}.`, status: 404 };
  }
  const resolved = await sampleTemplate(template);
  return resolved ? { output, template: resolved } : { error: TEMPLATE_FILE_GONE, status: 404 };
}
