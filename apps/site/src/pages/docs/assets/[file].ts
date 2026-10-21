import fs from 'node:fs';
import path from 'node:path';
import type { APIContext } from 'astro';
import { ASSET_TYPES, docsAssets, docsFolder } from '../../../lib/docs';

/** The images in docs/assets, written out at build time, so git holds them once. */
export function getStaticPaths() {
  return docsAssets().map((file) => ({ params: { file } }));
}

/** One image from docs/assets. */
export function GET({ params }: APIContext): Response {
  const file = path.basename(String(params.file));
  const body = fs.readFileSync(path.join(docsFolder(), 'assets', file));
  return new Response(body, { headers: { 'Content-Type': ASSET_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
}
