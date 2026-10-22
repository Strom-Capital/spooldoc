import 'server-only';

import { documentName, parseDefinition, renderDocument, starterTemplate, type Definition, type DocumentRender } from '@spooldoc/core';
import { carboneLocale } from '@/lib/formats';
import { FORMAT_FILES, perSpooledFile, spooledFileName, templateFileName, type Format, type JobTemplate, type TemplateContent } from '@/lib/job-spec';
import { getFormats } from './formats';
import { log } from './log';
import type { SampleTemplate } from './render';
import { carboneServer, noteRenderFailure, renderingReady } from './rendering';
import { getTemplateFile } from './template-files';

/**
 * The file name of the document of a page group: the definition's `output.name`, or `<fallback>-<n>`.
 * A document of the whole spooled file is named by `spooledFileName` in `lib/job-spec`.
 */
export function fileNameFor(def: Definition | null, pageGroup: Record<string, unknown>, index: number, fallback: string): string {
  if (def?.output?.name) {
    try {
      return documentName(def, pageGroup, index);
    } catch {
      // keep the fallback
    }
  }
  return `${fallback}-${index + 1}`;
}

/**
 * The name of each document of a spooled file, as a run names them: one per page group, in
 * order, then the whole spooled file's when `spooledFile` is set. Two documents with the
 * same name get `-2`, `-3` in that order, as their files do. A preview of one page group
 * takes its name from here, so it matches the run.
 */
export function documentNames(
  def: Definition | null,
  groups: Record<string, unknown>[],
  sample: { splf: { name: string } },
  spooledFile: boolean,
): { pageGroups: string[]; spooledFile: string | null } {
  const taken = new Set<string>();
  const unique = (base: string) => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  };
  const fallback = sample.splf.name.toLowerCase();
  const pageGroups = groups.map((group, index) => unique(fileNameFor(def, group, index, fallback)));
  return { pageGroups, spooledFile: spooledFile ? unique(spooledFileName(sample)) : null };
}

/** The file name a run gives a template's file of a document in a format, such as `invoice-260101.pdf`. */
export type RunFileName = (templateIndex: number, pageGroupIndex: number | null, format: Format) => string;

/**
 * The name of every file a run makes, over every template, document and format, in the order
 * a run renders them: by template, then by page group, or once for the whole spooled file,
 * then by format. A name already taken gets `-2`, `-3` before its extension. A preview of one
 * page group takes its names from here, so they match the run.
 */
export function runFileNames(templates: JobTemplate[], def: Definition | null, groups: Record<string, unknown>[], sample: { splf: { name: string } }): RunFileName {
  const taken = new Set<string>();
  const unique = (base: string, ext: string) => {
    let name = `${base}.${ext}`;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}.${ext}`;
    taken.add(name);
    return name;
  };
  const key = (templateIndex: number, pageGroupIndex: number | null, format: Format) => `${templateIndex}:${pageGroupIndex ?? 'splf'}:${format}`;
  const names = new Map<string, string>();
  const fallback = sample.splf.name.toLowerCase();
  for (const [templateIndex, template] of templates.entries()) {
    const documents = perSpooledFile(template)
      ? [{ index: null, base: spooledFileName(sample) }]
      : groups.map((group, index) => ({ index, base: fileNameFor(def, group, index, fallback) }));
    for (const document of documents) {
      const base = templateFileName(document.base, templates, template);
      for (const format of template.formats) names.set(key(templateIndex, document.index, format), unique(base, FORMAT_FILES[format].extension));
    }
  }
  return (templateIndex, pageGroupIndex, format) => {
    const name = names.get(key(templateIndex, pageGroupIndex, format));
    if (name !== undefined) return name;
    // A format the template does not make: named as a run would, after every other file.
    const template = templates[templateIndex]!;
    const base = pageGroupIndex === null ? spooledFileName(sample) : fileNameFor(def, groups[pageGroupIndex] ?? {}, pageGroupIndex, fallback);
    const extra = unique(templateFileName(base, templates, template), FORMAT_FILES[format].extension);
    names.set(key(templateIndex, pageGroupIndex, format), extra);
    return extra;
  };
}

/** The HTML of a template: its own, or the starter template. */
export function templateHtml(source: string | null | undefined, def: Definition): string {
  return source === null || source === undefined ? starterTemplate(def) : source;
}

/**
 * A template's content as `renderSample` takes it: HTML as it is, a Word or Excel template
 * with its file read. Null when the file is gone.
 */
export async function sampleTemplate(template: TemplateContent): Promise<SampleTemplate | null> {
  if (template.kind === 'html') return { kind: 'html', source: template.source };
  const file = template.fileId === null ? null : await getTemplateFile(template.fileId);
  if (template.fileId !== null && !file) return null;
  return template.kind === 'xlsx' ? { kind: 'xlsx', file, scope: template.scope } : { kind: 'docx', file };
}

/** Renders one document to a file. */
export type DocumentRenderer = (input: DocumentRender) => Promise<Uint8Array>;

let override: DocumentRenderer | null = null;

/** Render with something else than Carbone, for tests. Null goes back to Carbone. */
export function setDocumentRenderer(next: DocumentRenderer | null): void {
  override = next;
}

/**
 * A renderer for the Carbone server set in Settings, for one run or preview. A render
 * that can't reach Carbone, or that Carbone refuses, is noted, so Settings and the setup
 * checklist show it.
 *
 * @throws CarboneError when no Carbone server can be used, such as Carbone Cloud without a key
 */
export async function documentRenderer(): Promise<DocumentRenderer> {
  // Every render prints numbers, amounts and dates as Settings, Formats, says.
  const locale = carboneLocale(await getFormats());
  const withLocale = (render: DocumentRenderer): DocumentRenderer => (input) => render({ ...input, locale: input.locale ?? locale });
  if (override) return withLocale(override);
  const server = await carboneServer();
  return withLocale(async (input) => {
    try {
      return await renderDocument(server, input);
    } catch (error) {
      await noteRenderFailure(error);
      throw error;
    }
  });
}

/**
 * The renderer for a workbench preview, or null when the last check found Carbone not
 * working: with no working Carbone server there is no render to try.
 */
export async function previewRenderer(): Promise<DocumentRenderer | null> {
  if (!override && !(await renderingReady())) return null;
  try {
    return await documentRenderer();
  } catch (error) {
    log.warn('Could not use Carbone for a preview', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Parse a definition, or null when it does not parse. */
export function tryDefinition(yaml: string): Definition | null {
  try {
    return parseDefinition(yaml);
  } catch {
    return null;
  }
}
