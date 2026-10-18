import 'server-only';

import {
  documentName,
  extract,
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
import { getWorkspace } from './workspace';

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
  errors: string[];
}

/** Unsaved editor contents and the document to render. */
export interface RenderOverrides {
  yaml?: string;
  html?: string;
  document?: number;
}

/** Thrown when the sample does not exist. */
export class SampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Sample ${id} not found.`);
    this.name = 'SampleNotFoundError';
  }
}

/**
 * The sample without its raw bytes, with where its code page came from.
 *
 * @param sample - A sample from the workspace
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
 * Render a sample with its linked definition and template, or with unsaved overrides.
 * The template is `templates/<type>.html`, or the override, or else the starter
 * template for the definition (flagged `generated`). Every problem is reported in
 * `errors` and on the part it belongs to; nothing is thrown except for a missing sample.
 *
 * @param id - Sample id
 * @param overrides - Unsaved definition YAML or template HTML, and the document index
 * @throws SampleNotFoundError when there is no such sample; WorkspaceError for a bad id
 */
export async function renderSample(id: string, overrides: RenderOverrides = {}): Promise<RenderResult> {
  const ws = getWorkspace();
  const sample = await ws.readSample(id);
  if (!sample) {
    throw new SampleNotFoundError(id);
  }
  const errors: string[] = [];
  const result: RenderResult = { sample: sampleView(sample), document: 0, errors };

  let yaml = overrides.yaml;
  let type = sample.definition;
  if (yaml === undefined && type) {
    try {
      yaml = (await ws.readDefinition(type)) ?? undefined;
      if (yaml === undefined) {
        result.definition = { type, yaml: '', error: `There is no definitions/${type}.yaml yet.` };
        errors.push(result.definition.error as string);
      }
    } catch (error) {
      result.definition = { type, yaml: '', error: message(error) };
      errors.push(message(error));
    }
  }
  if (yaml === undefined) {
    return result;
  }

  let def: Definition | undefined;
  try {
    def = parseDefinition(yaml);
    type ??= def.type;
    result.definition = { type, yaml };
  } catch (error) {
    result.definition = { type: type ?? '', yaml, error: message(error) };
    errors.push(message(error));
  }

  let html = overrides.html;
  let generated = false;
  if (html === undefined && type) {
    try {
      html = (await ws.readTemplate(type)) ?? undefined;
    } catch (error) {
      errors.push(message(error));
    }
  }
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

  try {
    result.extract = extract(def, sample);
  } catch (error) {
    errors.push(`Extraction failed: ${message(error)}`);
    return result;
  }
  const documents = result.extract.documents;
  result.names = documents.map((doc, i) => documentName(def, doc, i));
  const index = Math.min(Math.max(0, Math.trunc(overrides.document ?? 0)), Math.max(0, documents.length - 1));
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
