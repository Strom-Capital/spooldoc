import { spooledFileData, templatePaths, type Definition } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { emailConfigSchema } from '@/lib/destination-config';
import { emailDocuments, emailSpecSchema, FORMAT_FILES, perSpooledFile, spooledFileName, templateFileName } from '@/lib/job-spec';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations } from '@/lib/server/db/schema';
import { fileNameFor, previewRenderer } from '@/lib/server/documents';
import {
  addressList,
  addressProblems,
  emailSpecProblems,
  emailSubject,
  expandSegments,
  expandText,
  fieldTypes,
  messageBody,
  type EmailFormatting,
} from '@/lib/server/email-message';
import { getFormats } from '@/lib/server/formats';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftPageGroup } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { getMailView } from '@/lib/server/mail';
import { renderSample } from '@/lib/server/render';
import type { EmailPreviewView } from '@/lib/types';

export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  /** The email part as the editor has it, saved or not. */
  email: emailSpecSchema,
  destinationId: z.string().uuid().nullable().optional(),
  pageGroup: z.number().int().nonnegative().optional(),
  /** `splf` for the email of the whole spooled file, when the run sends one; else a page group's. */
  document: z.enum(['pageGroup', 'splf']).optional(),
  sampleId: z.string().uuid().optional(),
});

/**
 * The single values an email field can read: the page group's fields and the spooled file's,
 * without tables and records. The email of the whole spooled file has no page group, so it
 * reads the spooled file's fields only.
 */
function emailFields(def: Definition, data: unknown, formatting: EmailFormatting, spooledFile: boolean): { path: string; value: string }[] {
  const paths = [...templatePaths(def)];
  const lists = new Set(paths.filter((path) => path.includes('[]')).map((path) => path.slice(0, path.indexOf('[]'))));
  const single = spooledFile ? /^splf\.[^.[\]]+$/ : /^(pg|splf)\.[^.[\]]+$/;
  return paths
    .filter((path) => single.test(path) && !lists.has(path))
    .map((path) => ({ path, value: expandText(`{d.${path}}`, data, formatting).text }));
}

/**
 * One email of the preview spooled file, as the job would send it: From, To, Cc, Bcc,
 * Reply-To and Subject with their fields filled in, the message, and the files that go
 * with it. It is the email of a page group, or the email of the whole spooled file when
 * the request asks for it or when page groups get no email. Nothing is sent.
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
  const body = await readJson(request, previewSchema);
  if ('response' in body) {
    return body.response;
  }
  const { email } = body.data;
  const picked = await draftPageGroup(job, body.data, 'the email');
  if ('response' in picked) {
    return picked.response;
  }
  const { draft, sample, def, groups, index } = picked;
  const templates = draft.render.templates;
  const sends = emailDocuments(templates, email.attach);
  // The whole spooled file's email when it is asked for, or when it is the only one the run sends.
  const whole = sends.spooledFile && (body.data.document === 'splf' || !sends.pageGroups);
  const data = whole ? spooledFileData(groups, sample) : { pg: groups[index]!, splf: sample.splf };
  const document = whole ? spooledFileName(sample) : fileNameFor(def, groups[index]!, index, sample.splf.name.toLowerCase());

  const destinationId = body.data.destinationId ?? draft.destination.destinationId;
  const [row] = destinationId ? await getDb().select({ kind: destinations.kind, config: destinations.config }).from(destinations).where(eq(destinations.id, destinationId)) : [];
  const testAddress = row?.kind === 'email' ? (emailConfigSchema.safeParse(row.config).data?.testAddress ?? null) : null;
  const mail = await getMailView();
  const formatting: EmailFormatting = { formats: await getFormats(), types: fieldTypes(def) };

  // The message template's HTML for this page group, rendered as a run renders it.
  let templateHtml: string | null = null;
  let bodyError: string | null = null;
  const template = email.bodyTemplateId ? draft.render.templates.find((t) => t.id === email.bodyTemplateId) : undefined;
  if (email.bodyTemplateId && template?.kind !== 'html') {
    bodyError = 'The message template is not an HTML template of the job. Pick another one, or write the message.';
  } else if (template?.kind === 'html' && !whole) {
    const rendered = await renderSample(sample, {
      yaml: draft.extract.definition,
      template: { kind: 'html', source: template.source },
      pageGroup: index,
      asset: await assetResolver(),
      assets: (await assetNames()).map((asset) => asset.name),
      renderer: await previewRenderer(),
    });
    templateHtml = rendered.html ?? null;
    if (!templateHtml) bodyError = rendered.carbone?.error ?? rendered.template?.error ?? rendered.errors[0] ?? 'The message template could not be rendered.';
  }

  const to = addressList(email.to, data, formatting).addresses;
  const cc = addressList(email.cc, data, formatting).addresses;
  const { html } = messageBody({ spec: email, data, templateHtml, wouldGoTo: testAddress ? to : null, wouldCopy: cc, formatting });
  const subject = email.subject.trim() ? expandSegments(email.subject, data, formatting) : [{ text: emailSubject(email, data, document, false, formatting) }];
  const where = whole ? 'Whole spooled file' : `Page group ${index + 1}`;
  const problems = addressProblems(email, data, formatting).map((problem) => `${where}: ${problem}. This email will fail.`);

  const attachments = templates
    .filter((t) => perSpooledFile(t) === whole)
    .flatMap((t) =>
      t.formats
        .filter((format) => email.attach.includes(format))
        .map((format) => ({ name: `${templateFileName(document, templates, t)}.${FORMAT_FILES[format].extension}`, format })),
    );
  const notices: string[] = [];
  if (whole && !sends.pageGroups) notices.push('One email for the whole spooled file. Page groups get no email, since Attach picks only its files.');
  // A run renders the message template for each page group only; the whole spooled file's email has the written message.
  if (whole && email.bodyTemplateId) notices.push('The message template makes the email of each page group only. This email has the written message: pick Text written here under Message from to change it.');

  const view: EmailPreviewView = {
    pageGroup: whole ? null : index,
    pageGroups: groups.length,
    pageGroupEmails: sends.pageGroups,
    spooledFileEmail: sends.spooledFile,
    document,
    from: mail.configured ? { address: mail.from, name: mail.fromName || null } : null,
    to: expandSegments(email.to, data, formatting),
    cc: expandSegments(email.cc, data, formatting),
    bcc: expandSegments(email.bcc, data, formatting),
    replyTo: expandSegments(email.replyTo, data, formatting),
    subject: testAddress ? [{ text: '[Test] ' }, ...subject] : subject,
    html: bodyError && !templateHtml ? '' : html,
    attachments,
    bodyError,
    testAddress,
    problems,
    notices,
    unknownTags: emailSpecProblems(email, def, draft.render.templates).filter((problem) => !problem.startsWith('Enter To')),
    fields: emailFields(def, data, formatting, whole),
  };
  return json(view);
}
