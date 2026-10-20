import { XLSX_SCOPES, type XlsxScope } from '@spooldoc/core/xlsx-scope';
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
export const FORMATS = ['pdf', 'html', 'docx', 'xlsx'] as const;
export type Format = (typeof FORMATS)[number];

/** The kinds of template: HTML, written in the app, or a Word or Excel file made in Word or Excel and uploaded. */
export const TEMPLATE_KINDS = ['html', 'docx', 'xlsx'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** The formats an HTML template renders to. */
export const HTML_FORMATS = ['pdf', 'html'] as const;

/** The formats each kind of template renders to. */
export const KIND_FORMATS: Record<TemplateKind, readonly Format[]> = { html: HTML_FORMATS, docx: ['pdf', 'docx'], xlsx: ['xlsx', 'pdf'] };

/**
 * How each kind of template is named in the app: "Word template", and with an article,
 * "a Word template", "an HTML template". The kinds made in another program upload a file
 * of `fileFormat`.
 */
export const KIND_NAMES: Record<TemplateKind, { name: string; article: 'A' | 'An'; app: string | null; fileFormat: Format | null }> = {
  html: { name: 'HTML template', article: 'An', app: null, fileFormat: null },
  docx: { name: 'Word template', article: 'A', app: 'Word', fileFormat: 'docx' },
  xlsx: { name: 'Excel template', article: 'An', app: 'Excel', fileFormat: 'xlsx' },
};

/** What a template has as its content, in a summary: "Starter Word template", "Excel template", "Custom template" for HTML. */
export function contentLabel(kind: TemplateKind, own: boolean): string {
  if (kind === 'html') return own ? 'Custom template' : 'Starter template';
  return own ? KIND_NAMES[kind].name : `Starter ${KIND_NAMES[kind].name}`;
}

/** "A Word template", "an HTML template" (with `lower`). */
export function kindName(kind: TemplateKind, lower = false): string {
  const { article, name } = KIND_NAMES[kind];
  return `${lower ? article.toLowerCase() : article} ${name}`;
}

/** The formats a new template of a kind makes: PDF, or XLSX only for an Excel template. */
export function kindDefaultFormats(kind: TemplateKind): Format[] {
  return kind === 'xlsx' ? ['xlsx'] : ['pdf'];
}

/** How each format is named in the app and stored as a file. */
export const FORMAT_FILES: Record<Format, { label: string; extension: string; contentType: string }> = {
  pdf: { label: 'PDF', extension: 'pdf', contentType: 'application/pdf' },
  html: { label: 'HTML', extension: 'html', contentType: 'text/html; charset=utf-8' },
  docx: { label: 'DOCX', extension: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { label: 'XLSX', extension: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};

/** "PDF and HTML". */
export function formatList(formats: readonly Format[]): string {
  return formats.map((format) => FORMAT_FILES[format].label).join(' and ');
}

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

/** The spooled file statuses a job takes: the watcher runs them and Run now lists them. */
export function triggerStatuses(trigger: { includeHeld: boolean }): string[] {
  return trigger.includeHeld ? ['READY', 'HELD'] : ['READY'];
}

/** A job's filters as the IBM i spooled file filter. */
export function ibmiFilter(filter: SourceFilter): { name?: string; userData?: string; jobName?: string; jobUser?: string; formType?: string } {
  const value = (text: string) => text.trim() || undefined;
  return { name: value(filter.splf), userData: value(filter.userData), jobName: value(filter.jobName), jobUser: value(filter.jobUser), formType: value(filter.formType) };
}

/** A template's id: lowercase letters, digits and dashes. */
export const TEMPLATE_ID = /^[a-z0-9-]{1,40}$/;

const htmlContent = z.object({ kind: z.literal('html'), source: z.string().max(500_000).nullable().default(null) });
const docxContent = z.object({ kind: z.literal('docx'), fileId: z.string().uuid().nullable().default(null) });

/**
 * What one file of an Excel template holds: the whole spooled file (`splf`, the default),
 * a row per line, or one page group (`pageGroup`), as HTML and Word templates do.
 */
export { XLSX_SCOPES, type XlsxScope };
const xlsxContent = z.object({ kind: z.literal('xlsx'), fileId: z.string().uuid().nullable().default(null), scope: z.enum(XLSX_SCOPES).default('splf') });

/**
 * What a template lays out with. HTML: `source: null` is the starter template generated
 * from the definition. Word and Excel: `fileId` is an uploaded template file, which never
 * changes, or null for the starter template generated from the definition. Excel: `scope`
 * says whether one file holds the whole spooled file or one page group.
 */
export type TemplateContent = z.infer<typeof htmlContent> | z.infer<typeof docxContent> | z.infer<typeof xlsxContent>;

/** The kinds of template whose content is an uploaded file. */
export type FileTemplateContent = Exclude<TemplateContent, { kind: 'html' }>;

/** True for a template whose content is a file made in Word or Excel. */
export function isFileTemplate<T extends TemplateContent>(template: T): template is Extract<T, { kind: 'docx' | 'xlsx' }> {
  return template.kind !== 'html';
}

/** True when the template makes one file of the whole spooled file, not one per page group. */
export function perSpooledFile(template: TemplateContent): boolean {
  return template.kind === 'xlsx' && template.scope === 'splf';
}

const templateFields = {
  id: z.string().regex(TEMPLATE_ID, 'Use lowercase letters, digits and dashes for a template id'),
  name: z.string().trim().min(1, 'Name the template').max(40, 'Use at most 40 characters for a template name'),
  formats: z
    .array(z.enum(FORMATS))
    .min(1, 'Pick at least one format')
    .transform((formats) => FORMATS.filter((f) => formats.includes(f))),
};

/** One template of a job: what it lays out with, and the formats it makes from each page group. */
const templateSchema = z
  .discriminatedUnion('kind', [htmlContent.extend(templateFields), docxContent.extend(templateFields), xlsxContent.extend(templateFields)])
  .superRefine((template, ctx) => {
    const allowed = KIND_FORMATS[template.kind];
    const other = template.formats.find((format) => !allowed.includes(format));
    if (other) {
      ctx.addIssue({
        code: 'custom',
        path: ['formats'],
        message: `${kindName(template.kind)} makes ${formatList(allowed)} files, not ${FORMAT_FILES[other].label}.`,
      });
    }
  });
export type JobTemplate = z.infer<typeof templateSchema>;

/** A template's content alone, without its id, name and formats. */
export function templateContent(template: TemplateContent): TemplateContent {
  if (template.kind === 'html') return { kind: 'html', source: template.source };
  if (template.kind === 'xlsx') return { kind: 'xlsx', fileId: template.fileId, scope: template.scope };
  return { kind: 'docx', fileId: template.fileId };
}

/** The starter content of a kind: no HTML, no file, and for Excel the whole spooled file in one file. */
export function starterContent(kind: TemplateKind): TemplateContent {
  if (kind === 'html') return { kind, source: null };
  if (kind === 'xlsx') return { kind, fileId: null, scope: 'splf' };
  return { kind, fileId: null };
}

/**
 * The template with other content. Content of the same kind keeps the formats; another
 * kind makes that kind's default (`kindDefaultFormats`), as a new template of it would,
 * so an HTML template that makes PDF makes XLSX as an Excel template.
 */
export function withContent(template: JobTemplate, content: TemplateContent): JobTemplate {
  const formats = content.kind === template.kind ? template.formats : kindDefaultFormats(content.kind);
  return { id: template.id, name: template.name, ...templateContent(content), formats };
}

/**
 * Which files a template stops making when it switches to another kind, or null when it
 * stops making none: "It makes XLSX files, not PDF. An Excel template makes XLSX and PDF."
 */
export function kindSwitchNote(template: JobTemplate, kind: TemplateKind): string | null {
  const kept = withContent(template, starterContent(kind)).formats;
  const dropped = template.formats.filter((format) => !kept.includes(format));
  if (dropped.length === 0) return null;
  return `It makes ${formatList(kept)} files, not ${formatList(dropped)}. ${kindName(kind)} makes ${formatList(KIND_FORMATS[kind])}.`;
}

/** True when the template has content of its own: HTML that was written, or an uploaded Word or Excel file. */
export function hasOwnContent(template: TemplateContent): boolean {
  return isFileTemplate(template) ? template.fileId !== null : template.source !== null;
}

/** Why a template's kind is settled (`settledKind`). */
export type KindReason = 'content' | 'chosen' | 'formats';

/**
 * The kind a template is for good, so the agent makes that kind without asking: its own
 * when it has content of its own, or when it is not HTML (a new template starts as HTML,
 * so another kind was chosen); else the one kind that makes every format it has. Null
 * when more than one kind would do, as for a new job's template, which makes PDF only.
 */
export function settledKind(template: JobTemplate): { kind: TemplateKind; reason: KindReason } | null {
  if (hasOwnContent(template)) return { kind: template.kind, reason: 'content' };
  if (template.kind !== 'html') return { kind: template.kind, reason: 'chosen' };
  const kinds = TEMPLATE_KINDS.filter((kind) => template.formats.every((format) => KIND_FORMATS[kind].includes(format)));
  return kinds.length === 1 ? { kind: kinds[0]!, reason: 'formats' } : null;
}

/** The template of a new job. */
function firstTemplate(): JobTemplate {
  return { id: 'template-1', name: 'Template 1', kind: 'html', source: null, formats: ['pdf'] };
}

/**
 * The template with this id, or else this name (any case); the first template when `key` is not given.
 * Null when there is no such template.
 */
export function findTemplate(templates: JobTemplate[], key?: string | null): JobTemplate | null {
  if (key === undefined || key === null) {
    return templates[0] ?? null;
  }
  const name = key.trim().toLowerCase();
  return templates.find((template) => template.id === key) ?? templates.find((template) => template.name.toLowerCase() === name) ?? null;
}

/** A template's name as part of a file name: "Order lines" is `order-lines`. Its id when nothing is left. */
export function templateSlug(template: Pick<JobTemplate, 'id' | 'name'>): string {
  const slug = template.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || template.id;
}

/**
 * A document's file name (without extension) from one template: the first template's files
 * keep the document's name, the others add their name, as in `invoice-260101-lines`.
 */
export function templateFileName(documentName: string, templates: Pick<JobTemplate, 'id'>[], template: Pick<JobTemplate, 'id' | 'name'>): string {
  return templates[0]?.id === template.id ? documentName : `${documentName}-${templateSlug(template)}`;
}

/** The file name (without extension) of a document of the whole spooled file: the spooled file's name, such as `spdinvoice`. */
export function spooledFileName(sample: { splf: { name: string } }): string {
  return sample.splf.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_') || 'document';
}

/** True when another template than `except` already has this name (any case). */
export function nameTaken(templates: JobTemplate[], name: string, except?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return templates.some((template) => template.id !== except && template.name.toLowerCase() === wanted);
}

/**
 * A new template for a job that has `templates`: the name given, or "Template 2" and so on,
 * an id made from the name that no other template has, the starter HTML template and PDF.
 */
export function newTemplate(templates: JobTemplate[], name?: string, formats: Format[] = ['pdf']): JobTemplate {
  let label = name?.trim();
  if (!label) {
    let n = templates.length + 1;
    while (nameTaken(templates, `Template ${n}`)) n++;
    label = `Template ${n}`;
  }
  const base = templateSlug({ id: 'template', name: label });
  let id = base;
  for (let n = 2; templates.some((template) => template.id === id); n++) id = `${base.slice(0, 36)}-${n}`;
  return { id, name: label, kind: 'html', source: null, formats: FORMATS.filter((f) => formats.includes(f)) };
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
      /** The job also takes held files, not only ready ones: the watcher runs them and Run now lists them. */
      includeHeld: z.boolean().default(false),
    })
    .default({ mode: 'manual', backlog: false, includeHeld: false }),
  extract: z.object({ definition: z.string().max(200_000).default('') }).default({ definition: '' }),
  render: z
    .object({ templates: z.array(templateSchema).min(1, 'Add at least one template') })
    .default(() => ({ templates: [firstTemplate()] })),
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
  const templates = spec.render.templates;
  const twice = new Set<string>();
  for (const [index, template] of templates.entries()) {
    if (templates.findIndex((other) => other.id === template.id) < index) {
      twice.add(`Render: two templates have the id "${template.id}". Give each template its own id.`);
    } else if (nameTaken(templates.slice(0, index), template.name)) {
      twice.add(`Render: two templates are named "${template.name}". Give each template its own name.`);
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
