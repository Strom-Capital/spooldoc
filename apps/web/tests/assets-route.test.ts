import { beforeEach, describe, expect, it } from 'vitest';
import { assetResolver, MAX_ASSET_BYTES, sniffAssetType, templateUsesAsset } from '@/lib/server/assets';
import type { AssetView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const listRoute = await import('@/app/api/assets/route');
const assetRoute = await import('@/app/api/assets/[id]/route');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WOFF2 = Buffer.from('wOF2\u0000\u0001\u0000\u0000rest', 'latin1');
const SVG = Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

let auth: Record<string, string>;

/** A multipart request like the Assets page sends. */
function multipart(path: string, method: 'POST' | 'PUT', fields: { name?: string; file?: Buffer; fileName?: string }): Request {
  const form = new FormData();
  if (fields.name !== undefined) form.set('name', fields.name);
  if (fields.file) form.set('file', new Blob([new Uint8Array(fields.file)]), fields.fileName ?? 'upload.bin');
  return new Request(`http://localhost:3000${path}`, { method, body: form, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', ...auth } });
}

async function create(name: string, file: Buffer): Promise<Response> {
  return listRoute.POST(multipart('/api/assets', 'POST', { name, file }));
}

async function list(): Promise<AssetView[]> {
  return (await (await listRoute.GET(appRequest('/api/assets', { headers: auth }))).json()).assets;
}

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('asset files', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['GIF', Buffer.from('GIF89a..'), 'image/gif'],
    ['WebP', Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'), 'image/webp'],
    ['SVG', SVG, 'image/svg+xml'],
    ['WOFF2', WOFF2, 'font/woff2'],
    ['WOFF', Buffer.from('wOFF....'), 'font/woff'],
    ['TTF', Buffer.from([0, 1, 0, 0, 0, 12]), 'font/ttf'],
    ['OTF', Buffer.from('OTTO....'), 'font/otf'],
    ['text', Buffer.from('hello'), null],
    ['HTML', Buffer.from('<html><svg></svg></html>'), null],
  ])('knows a %s file by its bytes', (_kind, bytes, type) => {
    expect(sniffAssetType(bytes)).toBe(type);
  });

  it('finds literal asset names in templates', () => {
    expect(templateUsesAsset(`<img src="{{ asset('logo') }}">`, 'logo')).toBe(true);
    expect(templateUsesAsset(`url("{{ asset( "logo" ) }}")`, 'logo')).toBe(true);
    expect(templateUsesAsset(`{{ asset('logo-dark') }}`, 'logo')).toBe(false);
    expect(templateUsesAsset(null, 'logo')).toBe(false);
  });
});

describe('assets', () => {
  it('uploads an image, lists it and serves the file without running scripts', async () => {
    const response = await create('logo', PNG);
    expect(response.status).toBe(201);
    const created = (await response.json()) as AssetView;
    expect(created).toMatchObject({ name: 'logo', kind: 'image', contentType: 'image/png', size: PNG.length, jobs: [] });
    expect(await list()).toEqual([created]);

    const file = await assetRoute.GET(appRequest(`/api/assets/${created.id}`, { headers: auth }), params({ id: created.id }));
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
  });

  it('takes the type from the bytes, not the file name', async () => {
    const response = await listRoute.POST(multipart('/api/assets', 'POST', { name: 'brand', file: WOFF2, fileName: 'brand.png' }));
    expect(await response.json()).toMatchObject({ kind: 'font', contentType: 'font/woff2' });
  });

  it.each([
    [{ name: 'logo', file: Buffer.from('not an image') }, 400, 'Upload an image'],
    [{ name: 'Logo', file: PNG }, 400, 'name: Use lowercase letters'],
    [{ name: '-logo', file: PNG }, 400, 'name: Use lowercase letters'],
    [{ name: 'logo' }, 400, 'file: Choose a file.'],
    [{ name: 'big', file: Buffer.concat([PNG, Buffer.alloc(MAX_ASSET_BYTES)]) }, 413, 'at most 5 MB'],
  ])('refuses %#', async (fields, status, message) => {
    const response = await listRoute.POST(multipart('/api/assets', 'POST', fields));
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: string }).error).toContain(message);
    expect(await list()).toEqual([]);
  });

  it('refuses a name that is taken', async () => {
    await create('logo', PNG);
    const response = await create('logo', SVG);
    expect(response.status).toBe(409);
    expect((await list()).map((a) => a.contentType)).toEqual(['image/png']);
  });

  it('replaces the file under the same name, and renders pick it up', async () => {
    const { id } = (await (await create('logo', PNG)).json()) as AssetView;
    expect((await assetResolver())('logo')).toBe(`data:image/png;base64,${PNG.toString('base64')}`);

    const response = await assetRoute.PUT(multipart(`/api/assets/${id}`, 'PUT', { file: SVG }), params({ id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, name: 'logo', contentType: 'image/svg+xml', size: SVG.length });
    expect((await assetResolver())('logo')).toBe(`data:image/svg+xml;base64,${SVG.toString('base64')}`);
  });

  it('lists the jobs whose template prints it', async () => {
    const serverId = await insertServer();
    const jobId = await insertJob(serverId, { render: { template: `<img src="{{ asset('logo') }}">`, formats: ['pdf'] } });
    await insertJob(serverId);
    await create('logo', PNG);
    await create('stamp', PNG);
    const [logo, stamp] = await list();
    expect(logo!.jobs).toEqual([{ id: jobId, name: 'Invoices' }]);
    expect(stamp!.jobs).toEqual([]);
  });

  it('deletes an asset, and renders no longer find it', async () => {
    const { id } = (await (await create('logo', PNG)).json()) as AssetView;
    expect((await assetResolver())('logo')).toBeDefined();
    const response = await assetRoute.DELETE(appRequest(`/api/assets/${id}`, { method: 'DELETE', headers: auth }), params({ id }));
    expect(response.status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await assetResolver())('logo')).toBeUndefined();
    expect((await assetRoute.DELETE(appRequest(`/api/assets/${id}`, { method: 'DELETE', headers: auth }), params({ id }))).status).toBe(404);
  });

  it('needs a session and a same-origin request', async () => {
    expect((await listRoute.GET(appRequest('/api/assets'))).status).toBe(401);
    const foreign = new Request('http://localhost:3000/api/assets', { method: 'POST', body: new FormData(), headers: { host: 'localhost:3000', origin: 'https://evil.example', ...auth } });
    expect((await listRoute.POST(foreign)).status).toBe(403);
  });
});
