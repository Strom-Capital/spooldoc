import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { getTemplateFileView, TEMPLATE_FILE_GONE } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';

/** A Word template file's name, size, time, who made it and the file it replaced; its bytes are at `/file`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const file = await getTemplateFileView((await params).id);
  return file ? json(file) : errorResponse(404, TEMPLATE_FILE_GONE);
}
