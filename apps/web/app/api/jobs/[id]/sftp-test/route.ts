import { guard } from '@/lib/server/auth';
import { errorResponse, readJson } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { sftpFolderSchema, sftpUploadTest } from '@/lib/server/sftp-folder';

export const dynamic = 'force-dynamic';

/**
 * Upload one page group of the preview spooled file, rendered from the draft, to the
 * destination's test folder. 409 without a test folder. Nothing goes in the Job log. The
 * answer lists each file with its final name, size and time; 502 when any failed.
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
  const body = await readJson(request, sftpFolderSchema);
  if ('response' in body) {
    return body.response;
  }
  return sftpUploadTest(job, body.data);
}
