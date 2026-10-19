import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { getTemplateFileView, TEMPLATE_FILE_GONE } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';

/** An uploaded Word template's name, size and upload time; its bytes are at `/file`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const file = await getTemplateFileView((await params).id);
  return file ? json(file) : errorResponse(404, TEMPLATE_FILE_GONE);
}
