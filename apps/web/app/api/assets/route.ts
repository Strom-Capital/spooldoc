import { guard } from '@/lib/server/auth';
import { ASSET_NAME, listAssets, readUpload } from '@/lib/server/assets';
import { getDb } from '@/lib/server/db';
import { assets } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Every asset without its bytes, with the jobs that print it. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json({ assets: await listAssets() });
}

/** Upload an asset: multipart `name` and `file`. 409 when the name is taken. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const upload = await readUpload(request);
  if ('error' in upload) {
    return errorResponse(upload.status, upload.error);
  }
  const name = String(upload.form.get('name') ?? '').trim();
  if (!ASSET_NAME.test(name)) {
    return errorResponse(400, 'name: Use lowercase letters, digits, dashes and underscores (at most 64), starting with a letter or digit.');
  }
  const [row] = await getDb()
    .insert(assets)
    .values({ name, contentType: upload.contentType, size: upload.content.length, content: upload.content })
    .onConflictDoNothing({ target: assets.name })
    .returning({ id: assets.id });
  if (!row) {
    return errorResponse(409, `name: There is already an asset named ${name}. Replace its file instead.`);
  }
  return json((await listAssets()).find((asset) => asset.id === row.id), { status: 201 });
}
