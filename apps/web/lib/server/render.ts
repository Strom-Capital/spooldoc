import 'server-only';

import {
  checkDocx,
  checkTemplate,
  checkXlsx,
  readXlsx,
  sheetsWithoutPageSetup,
  spooledFileData,
  starterXlsx,
  xlsxProblemText,
  type XlsxProblem,
  type XlsxTemplate,
  docxConverter,
  documentName,
  readDocx,
  starterDocx,
  docxProblemText,
  type DocxProblem,
  type DocxTemplate,
  extract,
  isCarboneError,
  matchProblems,
  parseDefinition,
  problemText,
  resolveCodePage,
  starterTemplate,
  templateData,
  templateUses,
  type AssetResolver,
  type CodePageSource,
  type Definition,
  type ExtractResult,
  type Lookup,
  type Sample,
  type TemplateProblem,
} from '@spooldoc/core';
import type { XlsxScope } from '@/lib/job-spec';
import type { TemplateFileView } from '@/lib/types';
import { getConfig } from './config';
import type { DocumentRenderer } from './documents';
import type { LookupsPreview } from './lookups';
import { templateFileView, type TemplateFileRow } from './template-files';

/** A sample as the browser gets it: everything but the raw bytes. */
export type SampleView = Omit<Sample, 'rawBase64'> & { codePageSource: CodePageSource | null };

/** Why nothing was rendered when Carbone is not connected. */
export const CARBONE_NOT_CONNECTED = 'Spooldoc renders documents with Carbone, which is not connected. Set it up in Settings, under Rendering.';

/**
 * The HTML template, and what is wrong with it: `problems` from Spooldoc's tag check, by
 * line, or `error` from Carbone with its own text in `detail`. `generated` for the starter template.
 */
export interface HtmlTemplateResult {
  kind: 'html';
  html: string;
  error?: string;
  detail?: string;
  problems?: TemplateProblem[];
  generated?: boolean;
}

/**
 * The Word template: the uploaded file (null for the starter template, `generated`), and
 * what is wrong with it: `problems` from the tag check, by part, or `error` from Carbone.
 */
export interface DocxTemplateResult {
  kind: 'docx';
  file: TemplateFileView | null;
  error?: string;
  detail?: string;
  problems?: DocxProblem[];
  generated?: boolean;
}

/**
 * The Excel template: the uploaded file (null for the starter template, `generated`), its
 * scope, the sheets without a page setup of their own (their PDF is US Letter portrait),
 * and what is wrong with it: `problems` from the tag check, by sheet and cell, or `error`
 * from Carbone.
 */
export interface XlsxTemplateResult {
  kind: 'xlsx';
  file: TemplateFileView | null;
  scope: XlsxScope;
  /** The sheets that have no page setup; only known once the file is read. */
  noPageSetup?: string[];
  error?: string;
  detail?: string;
  problems?: XlsxProblem[];
  generated?: boolean;
}

/** What the workbench shows for a sample: definition, template, extracted JSON and the rendered document. */
export interface RenderResult {
  sample: SampleView;
  definition?: { type: string; yaml: string; error?: string };
  template?: HtmlTemplateResult | DocxTemplateResult | XlsxTemplateResult;
  /** Carbone is not connected or did not answer, so nothing was rendered. */
  carbone?: { error: string; detail?: string };
  extract?: ExtractResult;
  /** The name of each page group's document, from the definition's `output.name`. */
  names?: string[];
  /** The rendered HTML of page group `pageGroup`'s document, from an HTML template. */
  html?: string;
  /** Page group `pageGroup`'s document as a PDF in base64, from a Word or Excel template; for an Excel template of the whole spooled file, that file's PDF. */
  pdf?: string;
  /** 0-based index of the rendered page group. An Excel template of the whole spooled file renders every page group. */
  pageGroup: number;
  /** Why the definition's `match` rules do not accept this file (runs skip such files). */
  mismatch?: string[];
  /** The job's lookups for page group `pageGroup`, when it has some. */
  lookups?: LookupsPreview;
  errors: string[];
}

/** Runs a job's lookups for some page groups of a preview; null when the job has none. See `previewLookups`. */
export type PreviewLookupRunner = (
  def: Definition,
  groups: Record<string, unknown>[],
  only: number[],
  names: string[],
) => Promise<{ groups: Record<string, unknown>[]; preview: LookupsPreview } | null>;

/** A template's content for `renderSample`: HTML (null for the starter template), or a Word or Excel file (null for the starter). */
export type SampleTemplate =
  | { kind: 'html'; source: string | null }
  | { kind: 'docx'; file: TemplateFileRow | null }
  | { kind: 'xlsx'; file: TemplateFileRow | null; scope: XlsxScope };

/** The definition, the template and the page group to render. */
export interface RenderInput {
  yaml: string;
  template: SampleTemplate;
  pageGroup?: number;
  /** Resolves `{asset('name')}` in the template. */
  asset?: AssetResolver;
  /** The uploaded asset names, for the tag check. */
  assets?: string[];
  /** Renders the document; null when Carbone is not connected, so the render is not tried. */
  renderer: DocumentRenderer | null;
  /** The job's lookups: the template check knows their paths, and `run` adds their values. */
  lookups?: { list: readonly Lookup[]; run: PreviewLookupRunner };
}

/**
 * The sample without its raw bytes, with where its code page came from.
 *
 * @param sample - A captured sample
 */
export function sampleView(sample: Sample): SampleView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { rawBase64, ...rest } = sample;
  let codePageSource: CodePageSource | null = null;
  try {
    const resolved = resolveCodePage(sample.attributes, getConfig().defaultCcsid);
    codePageSource = resolved.codePage === sample.codePage ? resolved.source : 'fallback';
  } catch {
    codePageSource = 'fallback';
  }
  return { ...rest, codePageSource };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A template ready to check and render: the HTML text, or the Word or Excel file's bytes as read. */
type Prepared =
  | { kind: 'html'; html: string }
  | { kind: 'docx'; bytes: Uint8Array; read: DocxTemplate }
  | { kind: 'xlsx'; bytes: Uint8Array; read: XlsxTemplate; scope: XlsxScope };

/** Carbone's error on the part it belongs to: the server, or the template. */
function renderError(result: RenderResult, error: unknown): string {
  const text = message(error);
  const detail = isCarboneError(error) ? error.detail : undefined;
  if (isCarboneError(error) && ['unreachable', 'timeout', 'auth', 'server'].includes(error.kind)) {
    result.carbone = { error: text, ...(detail ? { detail } : {}) };
  } else if (result.template) {
    result.template.error = text;
    if (detail) result.template.detail = detail;
  }
  return text;
}

/**
 * Render a sample with a definition and a template with Carbone: an HTML template to
 * HTML, a Word or Excel template to a PDF. An Excel template of the whole spooled file
 * renders every page group into one PDF. Without a template of its own the starter template for
 * the definition is used (flagged `generated`). The template is checked before it is rendered. Every problem is reported in
 * `errors` and on the part it belongs to; nothing is thrown.
 *
 * @param sample - The captured spooled file
 * @param input - Definition YAML, the template, the page group index and the renderer
 */
export async function renderSample(sample: Sample, input: RenderInput): Promise<RenderResult> {
  const errors: string[] = [];
  const result: RenderResult = { sample: sampleView(sample), pageGroup: 0, errors };
  const yaml = input.yaml;
  if (!yaml.trim()) {
    return result;
  }

  let def: Definition | undefined;
  try {
    def = parseDefinition(yaml);
    result.definition = { type: def.type, yaml };
  } catch (error) {
    result.definition = { type: '', yaml, error: message(error) };
    errors.push(message(error));
  }

  let html: string | undefined;
  if (input.template.kind === 'html') {
    html = input.template.source === null ? (def ? starterTemplate(def) : undefined) : input.template.source;
    if (html !== undefined) result.template = { kind: 'html', html, ...(input.template.source === null ? { generated: true } : {}) };
  } else if (input.template.kind === 'docx') {
    const file = input.template.file;
    result.template = { kind: 'docx', file: file ? templateFileView(file) : null, ...(file ? {} : { generated: true }) };
  } else {
    const file = input.template.file;
    result.template = { kind: 'xlsx', file: file ? templateFileView(file) : null, scope: input.template.scope, ...(file ? {} : { generated: true }) };
  }
  if (!def) {
    return result;
  }

  const mismatch = matchProblems(def, sample);
  if (mismatch.length > 0) {
    result.mismatch = mismatch;
  }
  try {
    result.extract = extract(def, sample);
  } catch (error) {
    errors.push(`Extraction failed: ${message(error)}`);
    return result;
  }
  let pageGroups = result.extract.pageGroups;
  result.names = pageGroups.map((group, i) => documentName(def, group, i));
  const index = Math.min(Math.max(0, Math.trunc(input.pageGroup ?? 0)), Math.max(0, pageGroups.length - 1));
  result.pageGroup = index;
  const lookups = input.lookups?.list ?? [];
  // The lookups run for the page group shown first, so the Lookups step has them whatever the template says.
  if (input.lookups && lookups.length > 0 && pageGroups[index]) {
    const looked = await input.lookups.run(def, pageGroups, [index], result.names);
    if (looked) {
      result.lookups = looked.preview;
      // The document still renders, without the lookups' values; the header lists why.
      if (looked.preview.error) errors.push(`Lookups: ${looked.preview.error.message}`);
      else pageGroups = looked.groups;
    }
  }
  const group = pageGroups[index];
  if (!group || !result.template) {
    return result;
  }

  let prepared: Prepared;
  if (input.template.kind === 'html' && html !== undefined && result.template.kind === 'html') {
    const problems = checkTemplate(html, def, { assets: input.assets, lookups });
    if (problems.length > 0) {
      result.template.problems = problems;
      result.template.error = problemText(problems);
      errors.push(...problems.map((p) => `Template line ${p.line}: ${p.message}`));
      return result;
    }
    prepared = { kind: 'html', html };
  } else if (input.template.kind === 'docx' && result.template.kind === 'docx') {
    try {
      const bytes = input.template.file?.content ?? (await starterDocx(def));
      prepared = { kind: 'docx', bytes, read: readDocx(bytes) };
    } catch (error) {
      result.template.error = message(error);
      errors.push(message(error));
      return result;
    }
    const problems = checkDocx(prepared.read, def, { lookups });
    if (problems.length > 0) {
      result.template.problems = problems;
      result.template.error = docxProblemText(problems);
      errors.push(...problems.map((p) => `Template ${p.part}: ${p.message}`));
      return result;
    }
  } else if (input.template.kind === 'xlsx' && result.template.kind === 'xlsx') {
    const scope = input.template.scope;
    try {
      const bytes = input.template.file?.content ?? await starterXlsx(def, scope);
      prepared = { kind: 'xlsx', bytes, read: readXlsx(bytes), scope };
    } catch (error) {
      result.template.error = message(error);
      errors.push(message(error));
      return result;
    }
    result.template.noPageSetup = sheetsWithoutPageSetup(prepared.read);
    const problems = checkXlsx(prepared.read, def, scope, { lookups });
    if (problems.length > 0) {
      result.template.problems = problems;
      result.template.error = xlsxProblemText(problems);
      errors.push(...xlsxProblemText(problems).split('\n').map((line) => `Template ${line}`));
      return result;
    }
  } else {
    return result;
  }

  if (!input.renderer) {
    result.carbone = { error: CARBONE_NOT_CONNECTED };
    return result;
  }
  // A template that reads every page group gets the lookups of every page group, as a run does.
  const readsAll = prepared.kind === 'xlsx' && prepared.scope === 'splf' ? true : templateUses(prepared.kind === 'html' ? prepared.html : prepared.read.text, 'pgs');
  if (readsAll && input.lookups && lookups.length > 0 && result.lookups && !result.lookups.error && pageGroups.length > 1) {
    const looked = await input.lookups.run(def, result.extract.pageGroups, pageGroups.map((_, i) => i), result.names);
    if (looked?.preview.error) result.lookups.error = looked.preview.error;
    else if (looked) pageGroups = looked.groups;
  }
  const shown = pageGroups[index]!;
  try {
    if (prepared.kind === 'html') {
      const out = await input.renderer({ template: prepared.html, data: templateData(prepared.html, shown, pageGroups, sample), format: 'html', asset: input.asset });
      result.html = Buffer.from(out).toString('utf8');
    } else if (prepared.kind === 'docx') {
      const data = templateData(prepared.read, shown, pageGroups, sample);
      const out = await input.renderer({ kind: 'docx', template: prepared.bytes, data, format: 'pdf', converter: docxConverter(prepared.read) });
      result.pdf = Buffer.from(out).toString('base64');
    } else {
      const data = prepared.scope === 'splf' ? spooledFileData(pageGroups, sample) : templateData(prepared.read, shown, pageGroups, sample);
      const out = await input.renderer({ kind: 'xlsx', template: prepared.bytes, data, format: 'pdf' });
      result.pdf = Buffer.from(out).toString('base64');
    }
  } catch (error) {
    errors.push(renderError(result, error));
  }
  return result;
}
