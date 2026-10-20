import { eq } from 'drizzle-orm';
import { isFileTemplate, jobSpecSchema, kindName, withContent } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { jobs } from '@/lib/server/db/schema';
import { lockJobRow } from '@/lib/server/draft-store';
import { errorResponse, json } from '@/lib/server/http';
import { readTemplateUpload, storeTemplateFile, templateFileView, type FileKind } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';

/**
 * Upload a Word or Excel file for one template of the draft: multipart `file` and
 * `templateId`. The file is checked as the template's kind: a `.docx` for a Word template,
 * a `.xlsx` for an Excel one. An HTML template takes the kind in `kind` (`docx`, the
 * default, or `xlsx`) and becomes that kind, keeping the formats it makes. The file is
 * stored as a new row, and the template uses it from then on. 201 with the file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const jobId = (await params).id;
  const kindOf = async (form: FormData): Promise<FileKind | { error: string; status: number }> => {
    const [row] = await getDb().select({ draft: jobs.draft }).from(jobs).where(eq(jobs.id, jobId));
    const template = row ? jobSpecSchema.parse(row.draft).render.templates.find((t) => t.id === String(form.get('templateId') ?? '')) : undefined;
    if (template && isFileTemplate(template)) return template.kind;
    const asked = form.get('kind') ?? 'docx';
    return asked === 'docx' || asked === 'xlsx' ? asked : { error: 'kind: Send docx or xlsx.', status: 400 };
  };
  const upload = await readTemplateUpload(request, kindOf);
  if ('error' in upload) {
    return errorResponse(upload.status, upload.error);
  }
  const templateId = String(upload.form.get('templateId') ?? '');
  const outcome = await getDb().transaction(async (tx) => {
    const row = await lockJobRow(tx, jobId);
    if (!row) {
      return { ok: false, status: 404, error: 'Job not found.' } as const;
    }
    const draft = jobSpecSchema.parse(row.draft);
    const target = draft.render.templates.find((template) => template.id === templateId);
    if (!target) {
      return { ok: false, status: 404, error: `templateId: The job has no template ${templateId || '(none given)'}.` } as const;
    }
    if (isFileTemplate(target) && target.kind !== upload.kind) {
      return { ok: false, status: 409, error: `The ${target.name} template became ${kindName(target.kind, true)} while the file was sent. Upload it again.` } as const;
    }
    const file = await storeTemplateFile(tx, { name: upload.name, content: upload.content, kind: upload.kind, userId: auth.user.id });
    const content = upload.kind === 'xlsx' ? { kind: 'xlsx' as const, fileId: file.id, scope: target.kind === 'xlsx' ? target.scope : ('splf' as const) } : { kind: 'docx' as const, fileId: file.id };
    const templates = draft.render.templates.map((template) => (template.id === templateId ? withContent(template, content) : template));
    await tx.update(jobs).set({ draft: { ...draft, render: { templates } } }).where(eq(jobs.id, jobId));
    return { ok: true, file } as const;
  });
  if (!outcome.ok) {
    return errorResponse(outcome.status, outcome.error);
  }
  return json(templateFileView(outcome.file), { status: 201 });
}
