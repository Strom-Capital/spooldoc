import { eq } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getAsset, listAssets, readUpload } from '@/lib/server/assets';
import { getDb } from '@/lib/server/db';
import { assets } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const findAsset = async (params: Context['params']) => {
  const id = (await params).id;
  return UUID.test(id) ? getAsset(id) : undefined;
};

/**
 * The asset's file, for thumbnails and font previews. An SVG opened on its own gets a
 * policy that runs no scripts.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await findAsset(params);
  if (!row) {
    return errorResponse(404, 'Asset not found.');
  }
  return new Response(new Uint8Array(row.content), {
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(row.size),
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache',
      ETag: `"${row.updatedAt.getTime()}"`,
    },
  });
}

/** Replace the asset's file and keep its name, so templates pick up the new file. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await findAsset(params);
  if (!row) {
    return errorResponse(404, 'Asset not found.');
  }
  const upload = await readUpload(request);
  if ('error' in upload) {
    return errorResponse(upload.status, upload.error);
  }
  await getDb()
    .update(assets)
    .set({ contentType: upload.contentType, size: upload.content.length, content: upload.content })
    .where(eq(assets.id, row.id));
  return json((await listAssets()).find((asset) => asset.id === row.id));
}

/** Delete the asset. Templates that print it fail to render until it is uploaded again. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await findAsset(params);
  if (!row) {
    return errorResponse(404, 'Asset not found.');
  }
  await getDb().delete(assets).where(eq(assets.id, row.id));
  return new Response(null, { status: 204 });
}
