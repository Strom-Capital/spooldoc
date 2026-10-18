import 'server-only';

import {
  documentName,
  extract,
  matchProblems,
  parseDefinition,
  renderTemplate,
  resolveCodePage,
  starterTemplate,
  type CodePageSource,
  type Definition,
  type ExtractResult,
  type Sample,
} from '@spooldoc/core';
import { getConfig } from './config';

/** A sample as the browser gets it: everything but the raw bytes. */
export type SampleView = Omit<Sample, 'rawBase64'> & { codePageSource: CodePageSource | null };

/** What the workbench shows for a sample: definition, template, extracted JSON and rendered HTML. */
export interface RenderResult {
  sample: SampleView;
  definition?: { type: string; yaml: string; error?: string };
  template?: { html: string; error?: string; generated?: boolean };
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
 * Render a sample with a definition and a template. Without a template the starter
 * template for the definition is used (flagged `generated`). Every problem is reported
 * in `errors` and on the part it belongs to; nothing is thrown.
 *
 * @param sample - The captured spooled file
 * @param input - Definition YAML, template HTML and the document index
 */
export function renderSample(sample: Sample, input: RenderInput): RenderResult {
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

  let html = input.html ?? undefined;
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
  if (html !== undefined && doc && result.template) {
    const rendered = renderTemplate(html, {
      doc,
      documents,
      sample: { id: sample.id, splf: sample.splf },
    });
    if (rendered.errors.length > 0) {
      result.template.error = rendered.errors.join('\n');
      errors.push(...rendered.errors);
    } else {
      result.html = rendered.html;
    }
  }
  return result;
}
