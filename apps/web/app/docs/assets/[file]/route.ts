import fs from 'node:fs';
import path from 'node:path';
import { docsFolder } from '@/lib/server/docs';

export const dynamic = 'force-static';
export const dynamicParams = false;

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function assetsFolder(): string {
  return path.join(docsFolder(), 'assets');
}

/** The images in docs/assets, written out when the app is built. */
export function generateStaticParams(): { file: string }[] {
  return fs
    .readdirSync(assetsFolder(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && path.extname(entry.name).toLowerCase() in TYPES)
    .map((entry) => ({ file: entry.name }));
}

/** One image from docs/assets. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const body = fs.readFileSync(path.join(assetsFolder(), path.basename(file)));
  return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
}
