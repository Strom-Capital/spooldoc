import { isCarboneError, readDocx, readXlsx, spooledFileData, starterDocx, starterXlsx, templateData, xlsxHardRefresh } from '@spooldoc/core';
import { z } from 'zod';
import { FORMAT_FILES, KIND_FORMATS, formatList, kindName, spooledFileName, templateFileName } from '@/lib/job-spec';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { fileNameFor, previewRenderer, tryDefinition } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample, previewTemplate, previewTemplateFields } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { previewLookupRunner, previewLookups } from '@/lib/server/lookups';
import { CARBONE_NOT_CONNECTED, renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const fileSchema = z.object({
  yaml: z.string().max(MAX_TEXT).optional(),
  ...previewTemplateFields,
  pageGroup: z.number().int().nonnegative().default(0),
  /** A PDF, or the filled-in DOCX of a Word template or XLSX of an Excel template. HTML is the render's own result. */
  format: z.enum(['pdf', 'docx', 'xlsx']).default('pdf'),
});

/**
 * The document of one page group of the preview sample as a PDF, or as a DOCX from a Word
 * template or an XLSX from an Excel template, from the draft or unsaved editor text,
 * rendered by Carbone. An Excel template of the whole spooled file makes the document of
 * every page group, named after the spooled file. 400 when there is no such page group
 * or the template does not make the format, 422 with `templateErrors` when the definition
 * or template fails, 503 when Carbone is not connected or does not answer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, fileSchema);
  if ('response' in body) {
    return body.response;
  }
  const { draft, sample } = await draftAndSample(job);
  if (!sample) {
    return errorResponse(404, 'Pick a spooled file to preview first.');
  }
  const yaml = body.data.yaml ?? draft.extract.definition;
  if (!yaml.trim()) {
    return errorResponse(400, 'Write a definition first.');
  }
  const picked = await previewTemplate(draft, body.data);
  if ('error' in picked) {
    return errorResponse(picked.status, picked.error);
  }
  const { content } = picked;
  const template = picked.template ?? draft.render.templates[0]!;
  const { pageGroup, format } = body.data;
  if (!KIND_FORMATS[content.kind].includes(format)) {
    return errorResponse(400, `${kindName(content.kind)} makes ${formatList(KIND_FORMATS[content.kind])} files.`);
  }
  const renderer = await previewRenderer();
  if (!renderer) {
    return errorResponse(503, CARBONE_NOT_CONNECTED);
  }
  const asset = await assetResolver();
  const assets = (await assetNames()).map((entry) => entry.name);
  // Checks the template and renders it first (HTML, or a PDF of a Word or Excel template), so a file is only made from a template that works.
  const result = await renderSample(sample, { yaml, template: content, pageGroup, asset, assets, renderer, lookups: previewLookupRunner(draft.source.serverId, draft.lookups) });
  if (result.carbone) {
    return json({ error: result.carbone.error, ...(result.carbone.detail ? { detail: result.carbone.detail } : {}) }, { status: 503 });
  }
  if (result.definition?.error || result.template?.error || !result.extract) {
    return json(
      { error: 'The definition or the template has errors.', templateErrors: result.errors, ...(result.template?.detail ? { detail: result.template.detail } : {}) },
      { status: 422 },
    );
  }
  let pageGroups = result.extract.pageGroups;
  if (pageGroup >= pageGroups.length) {
    return errorResponse(
      400,
      pageGroups.length === 0
        ? 'The definition finds no page groups in this spooled file.'
        : `There is no page group ${pageGroup + 1}: this spooled file has ${pageGroups.length}.`,
    );
  }
  if ((!result.html && !result.pdf) || !result.template) {
    return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
  }
  const wholeFile = content.kind === 'xlsx' && content.scope === 'splf';
  // The file gets the lookups' values, as the preview showed them; they come from the preview's cache.
  const lookupDef = tryDefinition(yaml);
  if (lookupDef && draft.lookups.length > 0) {
    const only = wholeFile ? pageGroups.map((_, i) => i) : [pageGroup];
    const looked = await previewLookups(draft.source.serverId, draft.lookups, lookupDef, pageGroups, only, result.names ?? []);
    if (looked && !looked.preview.error) pageGroups = looked.groups;
  }
  const filename = templateFileName(
    wholeFile ? spooledFileName(sample) : fileNameFor(tryDefinition(yaml), pageGroups[pageGroup] ?? {}, pageGroup, sample.splf.name.toLowerCase()),
    draft.render.templates,
    template,
  );
  const send = (content: Uint8Array) =>
    new Response(Buffer.from(content), {
      headers: {
        'Content-Type': FORMAT_FILES[format].contentType,
        'Content-Disposition': `attachment; filename="${filename}.${FORMAT_FILES[format].extension}"`,
        'Cache-Control': 'no-store',
      },
    });
  const group = pageGroups[pageGroup] ?? {};
  try {
    if (result.template.kind === 'html') {
      const html = result.template.html;
      return send(await renderer({ template: html, data: templateData(html, group, pageGroups, sample), format: 'pdf', pageWidth: sample.attributes.pageWidth, asset }));
    }
    if (format === 'pdf' && result.pdf) {
      return send(Buffer.from(result.pdf, 'base64'));
    }
    const def = tryDefinition(yaml);
    if (content.kind === 'xlsx') {
      const bytes = content.file ? content.file.content : def ? await starterXlsx(def, content.scope) : null;
      if (!bytes) {
        return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
      }
      const read = readXlsx(bytes);
      const data = wholeFile ? spooledFileData(pageGroups, sample) : templateData(read, group, pageGroups, sample);
      return send(await renderer({ kind: 'xlsx', template: bytes, data, format: 'xlsx', hardRefresh: xlsxHardRefresh(read) }));
    }
    const bytes = content.kind === 'docx' && content.file ? content.file.content : def ? await starterDocx(def) : null;
    if (!bytes) {
      return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
    }
    return send(await renderer({ kind: 'docx', template: bytes, data: templateData(readDocx(bytes), group, pageGroups, sample), format: 'docx' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : `Carbone could not render the ${FORMAT_FILES[format].label}.`;
    const detail = isCarboneError(error) ? error.detail : undefined;
    const status = isCarboneError(error) && ['template', 'edition', 'file'].includes(error.kind) ? 422 : 503;
    return json({ error: message, ...(detail ? { detail } : {}) }, { status });
  }
}
