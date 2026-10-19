import { eq } from 'drizzle-orm';
import { jobSpecSchema, withTemplate } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { jobs } from '@/lib/server/db/schema';
import { lockJobRow } from '@/lib/server/draft-store';
import { errorResponse, json } from '@/lib/server/http';
import { readTemplateUpload, storeTemplateFile, templateFileView } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';

/**
 * Upload a Word template for one output of the draft: multipart `file` (a `.docx`) and
 * `outputId`. The file is stored as a new row, and the output uses it from then on: an
 * HTML output becomes a Word one, keeping the formats a Word template makes. 201 with the file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const jobId = (await params).id;
  const upload = await readTemplateUpload(request);
  if ('error' in upload) {
    return errorResponse(upload.status, upload.error);
  }
  const outputId = String(upload.form.get('outputId') ?? '');
  const outcome = await getDb().transaction(async (tx) => {
    const row = await lockJobRow(tx, jobId);
    if (!row) {
      return { ok: false, status: 404, error: 'Job not found.' } as const;
    }
    const draft = jobSpecSchema.parse(row.draft);
    if (!draft.render.outputs.some((output) => output.id === outputId)) {
      return { ok: false, status: 404, error: `outputId: The job has no output ${outputId || '(none given)'}.` } as const;
    }
    const file = await storeTemplateFile(tx, { name: upload.name, content: upload.content, userId: auth.user.id });
    const outputs = draft.render.outputs.map((output) => (output.id === outputId ? withTemplate(output, { kind: 'docx', fileId: file.id }) : output));
    await tx.update(jobs).set({ draft: { ...draft, render: { outputs } } }).where(eq(jobs.id, jobId));
    return { ok: true, file } as const;
  });
  if (!outcome.ok) {
    return errorResponse(outcome.status, outcome.error);
  }
  return json(templateFileView(outcome.file), { status: 201 });
}
