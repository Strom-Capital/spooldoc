import { templatePaths, type Definition } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { emailConfigSchema } from '@/lib/destination-config';
import { emailSpecSchema, FORMAT_FILES, perSpooledFile, templateFileName } from '@/lib/job-spec';
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
  sampleId: z.string().uuid().optional(),
});

/** The single values an email field can read: the page group's fields and the spooled file's, without tables and records. */
function emailFields(def: Definition, data: unknown, formatting: EmailFormatting): { path: string; value: string }[] {
  const paths = [...templatePaths(def)];
  const lists = new Set(paths.filter((path) => path.includes('[]')).map((path) => path.slice(0, path.indexOf('[]'))));
  return paths
    .filter((path) => /^(pg|splf)\.[^.[\]]+$/.test(path) && !lists.has(path))
    .map((path) => ({ path, value: expandText(`{d.${path}}`, data, formatting).text }));
}

/**
 * The email of one page group of the preview spooled file, as the job would send it:
 * From, To, Cc, Bcc, Reply-To and Subject with their fields filled in, the message, and
 * the files that go with it. Nothing is sent.
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
  const data = { pg: groups[index]!, splf: sample.splf };
  const document = fileNameFor(def, groups[index]!, index, sample.splf.name.toLowerCase());

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
  } else if (template?.kind === 'html') {
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
  const { html } = messageBody({ spec: email, data, templateHtml, wouldGoTo: testAddress ? to : null, formatting });
  const subject = email.subject.trim() ? expandSegments(email.subject, data, formatting) : [{ text: emailSubject(email, data, document, false, formatting) }];
  const attachments = draft.render.templates
    .filter((t) => !perSpooledFile(t))
    .flatMap((t) =>
      t.formats
        .filter((format) => email.attach.includes(format))
        .map((format) => ({ name: `${templateFileName(document, draft.render.templates, t)}.${FORMAT_FILES[format].extension}`, format })),
    );
  // As a run decides: a page group gets no email when Attach picks files of the whole spooled file but none of its own.
  const wholeOnly = attachments.length === 0 && draft.render.templates.some((t) => perSpooledFile(t) && t.formats.some((format) => email.attach.includes(format)));
  const problems = wholeOnly
    ? ['Page groups get no email: Attach picks only files of the whole spooled file, so one email goes out for the whole spooled file.']
    : addressProblems(email, data, formatting).map((problem) => `Page group ${index + 1}: ${problem}. This email will fail.`);

  const view: EmailPreviewView = {
    pageGroup: index,
    pageGroups: groups.length,
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
    unknownTags: emailSpecProblems(email, def, draft.render.templates).filter((problem) => !problem.startsWith('Enter To')),
    fields: emailFields(def, data, formatting),
  };
  return json(view);
}
