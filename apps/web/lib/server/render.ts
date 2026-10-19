import 'server-only';

import {
  checkTemplate,
  convertNunjucks,
  documentName,
  extract,
  isCarboneError,
  matchProblems,
  parseDefinition,
  problemText,
  resolveCodePage,
  starterTemplate,
  templateData,
  type AssetResolver,
  type CodePageSource,
  type Definition,
  type ExtractResult,
  type Sample,
  type TemplateProblem,
} from '@spooldoc/core';
import { getConfig } from './config';
import type { DocumentRenderer } from './documents';

/** A sample as the browser gets it: everything but the raw bytes. */
export type SampleView = Omit<Sample, 'rawBase64'> & { codePageSource: CodePageSource | null };

/** Why nothing was rendered when Carbone is not connected. */
export const CARBONE_NOT_CONNECTED = 'Spooldoc renders documents with Carbone, which is not connected. Set it up in Settings, under Rendering.';

/** What the workbench shows for a sample: definition, template, extracted JSON and rendered HTML. */
export interface RenderResult {
  sample: SampleView;
  definition?: { type: string; yaml: string; error?: string };
  /**
   * The template, and what is wrong with it: `problems` from Spooldoc's tag check, by
   * line, or `error` from Carbone with its own text in `detail`.
   */
  template?: { html: string; error?: string; detail?: string; problems?: TemplateProblem[]; generated?: boolean };
  /** Carbone is not connected or did not answer, so nothing was rendered. */
  carbone?: { error: string; detail?: string };
  extract?: ExtractResult;
  /** One name per extracted document, from the definition's `output.name`. */
  names?: string[];
  /** The rendered HTML of document `document`. */
  html?: string;
  /** 0-based index of the rendered document. */
  document: number;
  /** Why the definition's `match` rules do not accept this file (runs skip such files). */
  mismatch?: string[];
  errors: string[];
}

/** The definition, the template (null for the starter template) and the document to render. */
export interface RenderInput {
  yaml: string;
  html: string | null;
  document?: number;
  /** Resolves `{asset('name')}` in the template. */
  asset?: AssetResolver;
  /** The uploaded asset names, for the tag check. */
  assets?: string[];
  /** Renders the HTML; null when Carbone is not connected, so the render is not tried. */
  renderer: DocumentRenderer | null;
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

/**
 * Render a sample with a definition and a template, to HTML with Carbone. Without a
 * template the starter template for the definition is used (flagged `generated`); a
 * Nunjucks template from before Carbone is converted. The template is checked before it
 * is rendered. Every problem is reported in `errors` and on the part it belongs to;
 * nothing is thrown.
 *
 * @param sample - The captured spooled file
 * @param input - Definition YAML, template HTML, the document index and the renderer
 */
export async function renderSample(sample: Sample, input: RenderInput): Promise<RenderResult> {
  const errors: string[] = [];
  const result: RenderResult = { sample: sampleView(sample), document: 0, errors };
  const yaml = input.yaml;
  if (!yaml.trim()) {
    return result;
  }
  let type: string | undefined;

  let def: Definition | undefined;
  try {
    def = parseDefinition(yaml);
    type ??= def.type;
    result.definition = { type, yaml };
  } catch (error) {
    result.definition = { type: type ?? '', yaml, error: message(error) };
    errors.push(message(error));
  }

  let html = input.html === null ? undefined : convertNunjucks(input.html);
  let generated = false;
  if (html === undefined && def) {
    html = starterTemplate(def);
    generated = true;
  }
  if (html !== undefined) {
    result.template = { html, ...(generated ? { generated: true } : {}) };
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
  const documents = result.extract.documents;
  result.names = documents.map((doc, i) => documentName(def, doc, i));
  const index = Math.min(Math.max(0, Math.trunc(input.document ?? 0)), Math.max(0, documents.length - 1));
  result.document = index;
  const doc = documents[index];
  if (html === undefined || !doc || !result.template) {
    return result;
  }
  const problems = checkTemplate(html, def, { assets: input.assets });
  if (problems.length > 0) {
    result.template.problems = problems;
    result.template.error = problemText(problems);
    errors.push(...problems.map((p) => `Template line ${p.line}: ${p.message}`));
    return result;
  }
  if (!input.renderer) {
    result.carbone = { error: CARBONE_NOT_CONNECTED };
    return result;
  }
  try {
    const out = await input.renderer({ template: html, data: templateData(html, doc, documents, sample), format: 'html', asset: input.asset });
    result.html = Buffer.from(out).toString('utf8');
  } catch (error) {
    const text = message(error);
    const detail = isCarboneError(error) ? error.detail : undefined;
    if (isCarboneError(error) && ['unreachable', 'timeout', 'auth', 'server'].includes(error.kind)) {
      result.carbone = { error: text, ...(detail ? { detail } : {}) };
    } else {
      result.template.error = text;
      if (detail) result.template.detail = detail;
    }
    errors.push(text);
  }
  return result;
}
