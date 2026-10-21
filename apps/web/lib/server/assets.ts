import 'server-only';

import { imageInfo, type AssetResolver, type DesignImage } from '@spooldoc/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { jobSpecSchema, type JobSpec } from '@/lib/job-spec';
import type { AssetView } from '@/lib/types';
import { getDb } from './db';
import { assets, jobs, jobVersions } from './db/schema';

/** Lowercase letters, digits, dashes and underscores; starts with a letter or digit. Same rule as the table's check. */
export const ASSET_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The largest file an asset can be. Every render carries it as base64, so keep logos and fonts small. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0): boolean => prefix.every((b, i) => bytes[at + i] === b);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/**
 * The type of an image or font file from its first bytes, or null for anything else.
 * The browser's file type is not trusted: the bytes decide.
 */
export function sniffAssetType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, ...ascii('PNG\r\n'), 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('wOF2'))) return 'font/woff2';
  if (startsWith(bytes, ascii('wOFF'))) return 'font/woff';
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, ascii('true'))) return 'font/ttf';
  if (startsWith(bytes, ascii('OTTO'))) return 'font/otf';
  // SVG is text: an optional BOM, XML declaration, comments or doctype, then <svg.
  // A comment ends at its first -->, so the pattern cannot backtrack across comments.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^﻿/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--(?:[^-]|-(?!->))*-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/** `image` or `font`, from the content type. */
export const assetKind = (contentType: string): AssetView['kind'] => (contentType.startsWith('font/') ? 'font' : 'image');

/** A file as a data URI, which is what `{asset('name')}` prints. */
export const dataUri = (contentType: string, content: Uint8Array): string => `data:${contentType};base64,${Buffer.from(content).toString('base64')}`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when a template prints the asset: `{asset('logo')}`. */
export function templateUsesAsset(template: string | null | undefined, name: string): boolean {
  return !!template && new RegExp(`\\{asset\\(\\s*(['"])${escapeRegExp(name)}\\1\\s*\\)\\}`).test(template);
}

type AssetRow = typeof assets.$inferSelect;

/** Every asset without its bytes, by name, with the jobs that print it. */
export async function listAssets(): Promise<AssetView[]> {
  const db = getDb();
  const rows = await db
    .select({ id: assets.id, name: assets.name, contentType: assets.contentType, size: assets.size, updatedAt: assets.updatedAt })
    .from(assets)
    .orderBy(asc(assets.name));
  const jobRows = await db
    .select({ id: jobs.id, name: jobs.name, draft: jobs.draft, active: jobVersions.spec })
    .from(jobs)
    .leftJoin(jobVersions, and(eq(jobVersions.jobId, jobs.id), eq(jobVersions.number, jobs.activeVersion)))
    .orderBy(asc(jobs.name));
  // Parsed, so a spec the schema refuses counts as printing nothing.
  const templates = (spec: JobSpec | null): string[] => {
    const render = jobSpecSchema.shape.render.safeParse(spec?.render);
    return render.success ? render.data.templates.flatMap((template) => (template.kind === 'html' ? (template.source ?? []) : [])) : [];
  };
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: assetKind(row.contentType),
    contentType: row.contentType,
    size: row.size,
    updatedAt: row.updatedAt.toISOString(),
    jobs: jobRows
      .filter((job) => [...templates(job.draft), ...templates(job.active)].some((html) => templateUsesAsset(html, row.name)))
      .map((job) => ({ id: job.id, name: job.name })),
  }));
}

/** One asset with its bytes, or undefined. */
export async function getAsset(id: string): Promise<AssetRow | undefined> {
  const [row] = await getDb().select().from(assets).where(eq(assets.id, id));
  return row;
}

/** The names of every asset, for the chat model. */
export async function assetNames(): Promise<{ name: string; kind: AssetView['kind'] }[]> {
  const rows = await getDb().select({ name: assets.name, contentType: assets.contentType }).from(assets).orderBy(asc(assets.name));
  return rows.map((row) => ({ name: row.name, kind: assetKind(row.contentType) }));
}

/** The PNG and JPEG assets with their size in pixels, by name: the pictures a Word template the agent designs can place. */
export async function imageAssets(): Promise<Map<string, DesignImage>> {
  const rows = await getDb()
    .select({ name: assets.name, content: assets.content })
    .from(assets)
    .where(inArray(assets.contentType, ['image/png', 'image/jpeg']));
  const out = new Map<string, DesignImage>();
  for (const row of rows) {
    const info = imageInfo(row.content);
    if (info) out.set(row.name, { data: row.content, ...info });
  }
  return out;
}

let cache: { key: string; uris: Map<string, string> } | null = null;

/**
 * Resolves `{asset('name')}` for a render. The data URIs are kept in memory and read
 * again only when the assets change (count or last change differ), also when another
 * process changed them.
 */
export async function assetResolver(): Promise<AssetResolver> {
  const db = getDb();
  const [state] = await db.select({ count: sql<number>`count(*)::int`, last: sql<string | null>`max(${assets.updatedAt})::text` }).from(assets);
  const key = `${state?.count ?? 0}|${state?.last ?? ''}`;
  if (cache?.key !== key) {
    const rows = await db.select({ name: assets.name, contentType: assets.contentType, content: assets.content }).from(assets);
    cache = { key, uris: new Map(rows.map((row) => [row.name, dataUri(row.contentType, row.content)])) };
  }
  const uris = cache.uris;
  return (name) => uris.get(name);
}

/**
 * The `file` field of a multipart upload, checked: at most `MAX_ASSET_BYTES`, and an
 * image (PNG, JPEG, GIF, WebP, SVG) or font (WOFF2, WOFF, TTF, OTF) by its bytes.
 *
 * @returns The bytes, their type and the form, or the problem to show
 */
export async function readUpload(request: Request): Promise<{ content: Buffer; contentType: string; form: FormData } | { error: string; status: number }> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_ASSET_BYTES + 64 * 1024) {
    return { error: `The file is too large: assets can be at most ${MAX_ASSET_BYTES / 1024 / 1024} MB.`, status: 413 };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: 'Send the file as multipart/form-data.', status: 400 };
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return { error: 'file: Choose a file.', status: 400 };
  }
  if (file.size > MAX_ASSET_BYTES) {
    return { error: `The file is too large: assets can be at most ${MAX_ASSET_BYTES / 1024 / 1024} MB.`, status: 413 };
  }
  const content = Buffer.from(await file.arrayBuffer());
  const contentType = sniffAssetType(content);
  if (!contentType) {
    return { error: 'file: Upload an image (PNG, JPEG, GIF, WebP or SVG) or a font (WOFF2, WOFF, TTF or OTF).', status: 400 };
  }
  return { content, contentType, form };
}
