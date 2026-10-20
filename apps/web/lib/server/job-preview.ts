import 'server-only';

import type { Sample } from '@spooldoc/core';
import { z } from 'zod';
import { findTemplate, jobSpecSchema, XLSX_SCOPES, type JobTemplate, type JobSpec, type TemplateContent, type XlsxScope } from '@/lib/job-spec';
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

/** The template fields of a preview request: unsaved editor text, or a Word or Excel template, else the draft template's content. */
export const previewTemplateFields = {
  /** HTML; `null` means the starter template. */
  html: z.string().max(MAX_TEXT).nullable().optional(),
  /** A Word template; `fileId: null` means the Word starter template. */
  docx: z.object({ fileId: z.string().uuid().nullable() }).optional(),
  /** An Excel template; `fileId: null` means the Excel starter template for the scope. */
  xlsx: z.object({ fileId: z.string().uuid().nullable(), scope: z.enum(XLSX_SCOPES) }).optional(),
  /** The draft template that is rendered, with its content when neither is given; missing means the first. */
  templateId: z.string().max(40).optional(),
};

/**
 * What a preview renders: the content in the request, which wins so a template changed
 * a moment ago renders before its draft is saved, or else the draft template's content.
 * `template` is null when the request names no template the draft has.
 */
export async function previewTemplate(
  draft: JobSpec,
  input: { html?: string | null; docx?: { fileId: string | null }; xlsx?: { fileId: string | null; scope: XlsxScope }; templateId?: string },
): Promise<{ template: JobTemplate | null; content: SampleTemplate } | { error: string; status: number }> {
  const template = findTemplate(draft.render.templates, input.templateId);
  let content: TemplateContent;
  if (input.docx) {
    content = { kind: 'docx', fileId: input.docx.fileId };
  } else if (input.xlsx) {
    content = { kind: 'xlsx', fileId: input.xlsx.fileId, scope: input.xlsx.scope };
  } else if (input.html !== undefined) {
    content = { kind: 'html', source: input.html };
  } else if (template) {
    content = template;
  } else {
    return { error: `The job has no template ${input.templateId}.`, status: 404 };
  }
  const resolved = await sampleTemplate(content);
  return resolved ? { template, content: resolved } : { error: TEMPLATE_FILE_GONE, status: 404 };
}
