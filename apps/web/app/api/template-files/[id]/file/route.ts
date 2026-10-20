import { guard } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/http';
import { getTemplateFile } from '@/lib/server/template-files';

export const dynamic = 'force-dynamic';

/** An uploaded Word or Excel template's bytes, as the file that was uploaded. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const file = await getTemplateFile((await params).id);
  if (!file) {
    return errorResponse(404, 'Template file not found.');
  }
  // Headers are Latin-1: the plain name is ASCII, the full one is in filename*.
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_');
  return new Response(Buffer.from(file.content), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
