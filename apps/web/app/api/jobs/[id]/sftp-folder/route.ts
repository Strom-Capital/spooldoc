import { guard } from '@/lib/server/auth';
import { errorResponse, readJson } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { sftpFolder, sftpFolderSchema } from '@/lib/server/sftp-folder';

export const dynamic = 'force-dynamic';

/**
 * The folder of the job's SFTP destination, listed, with one page group of the preview
 * spooled file placed in it: each of its files tagged with what a run will do. Nothing is
 * written. 502 with `error` when the server cannot be reached or the folder read.
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
  return sftpFolder(job, body.data);
}
