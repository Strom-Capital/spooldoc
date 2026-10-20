import 'server-only';

import { DOCX_CONTENT_TYPE, MAX_TEMPLATE_FILE_BYTES, XLSX_CONTENT_TYPE, docxProblem, xlsxProblem } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { FORMAT_FILES, kindName } from '@/lib/job-spec';
import type { TemplateFileDetails, TemplateFileView } from '@/lib/types';
import { getDb, type Db, type Tx } from './db';
import { templateFiles } from './db/schema';
import { UUID } from './servers';

/** A Word or Excel template file, with its bytes. */
export type TemplateFileRow = typeof templateFiles.$inferSelect;

/** The kinds of template whose content is a file. */
export type FileKind = 'docx' | 'xlsx';

/** Each file kind's content type, and the check of its bytes. */
const FILE_KINDS: Record<FileKind, { contentType: string; problem: (bytes: Uint8Array) => string | null }> = {
  docx: { contentType: DOCX_CONTENT_TYPE, problem: docxProblem },
  xlsx: { contentType: XLSX_CONTENT_TYPE, problem: xlsxProblem },
};

/** Why a Word or Excel template a job points at can't be used: the file is not there. */
export const TEMPLATE_FILE_GONE = 'The template file is gone. Upload the template again.';

type ViewColumns = Pick<TemplateFileRow, 'id' | 'name' | 'size' | 'createdAt' | 'madeBy' | 'previousId'>;

/** A template file without its bytes. */
export function templateFileView(row: ViewColumns): TemplateFileView {
  return { id: row.id, name: row.name, size: row.size, createdAt: row.createdAt.toISOString(), madeBy: row.madeBy, previousId: row.previousId };
}

const VIEW = {
  id: templateFiles.id,
  name: templateFiles.name,
  size: templateFiles.size,
  createdAt: templateFiles.createdAt,
  madeBy: templateFiles.madeBy,
  previousId: templateFiles.previousId,
};

/** One template file with its bytes, or null. */
export async function getTemplateFile(id: string, db: Db | Tx = getDb()): Promise<TemplateFileRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(templateFiles).where(eq(templateFiles.id, id));
  return row ?? null;
}

/** One template file without its bytes, with the file it replaced when that is still kept; or null. */
export async function getTemplateFileView(id: string): Promise<TemplateFileDetails | null> {
  if (!UUID.test(id)) return null;
  const [row] = await getDb().select(VIEW).from(templateFiles).where(eq(templateFiles.id, id));
  if (!row) return null;
  const [previous] = row.previousId ? await getDb().select(VIEW).from(templateFiles).where(eq(templateFiles.id, row.previousId)) : [];
  return { ...templateFileView(row), previous: previous ? templateFileView(previous) : null };
}

/** A file name without folders and control characters; `template.docx` or `template.xlsx` when nothing is left. */
function cleanName(name: string, kind: FileKind): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200);
  return clean || `template.${kind}`;
}

/**
 * The `file` field of a multipart upload, checked as a Word or Excel template by its
 * bytes: at most `MAX_TEMPLATE_FILE_BYTES`, and a `.docx` with `word/document.xml` in it or
 * a `.xlsx` with `xl/workbook.xml`. `kind` is the kind to check it as, or a function that
 * finds it from the form's other fields, such as the template the file is for.
 *
 * @returns The bytes, the file's name and the form, or the problem to show
 */
export async function readTemplateUpload(
  request: Request,
  kind: FileKind | ((form: FormData) => Promise<FileKind | { error: string; status: number }>),
): Promise<{ content: Buffer; name: string; form: FormData; kind: FileKind } | { error: string; status: number }> {
  const tooLarge = `The file is too large: Word and Excel templates can be at most ${MAX_TEMPLATE_FILE_BYTES / 1024 / 1024} MB.`;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_TEMPLATE_FILE_BYTES + 64 * 1024) {
    return { error: tooLarge, status: 413 };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: 'Send the file as multipart/form-data.', status: 400 };
  }
  const fileKind = typeof kind === 'function' ? await kind(form) : kind;
  if (typeof fileKind !== 'string') return fileKind;
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return { error: `file: Choose ${kindName(fileKind, true)} (.${FORMAT_FILES[fileKind].extension}).`, status: 400 };
  }
  if (file.size > MAX_TEMPLATE_FILE_BYTES) {
    return { error: tooLarge, status: 413 };
  }
  const content = Buffer.from(await file.arrayBuffer());
  const problem = FILE_KINDS[fileKind].problem(content);
  if (problem) {
    return { error: `file: ${problem}`, status: 400 };
  }
  return { content, name: cleanName(file instanceof File ? file.name : '', fileKind), form, kind: fileKind };
}

/** What `storeTemplateFile` stores. */
export interface NewTemplateFile {
  name: string;
  content: Uint8Array;
  /** Default `docx`. */
  kind?: FileKind;
  userId: string | null;
  /** Default `upload`. */
  madeBy?: TemplateFileRow['madeBy'];
  /** The file the template used before; for a file the agent made. */
  previousId?: string | null;
}

/** Stores a Word or Excel template as a new row. */
export async function storeTemplateFile(db: Db | Tx, input: NewTemplateFile): Promise<TemplateFileRow> {
  const content = Buffer.from(input.content);
  const kind = input.kind ?? 'docx';
  const [row] = await db
    .insert(templateFiles)
    .values({
      name: cleanName(input.name, kind),
      contentType: FILE_KINDS[kind].contentType,
      size: content.length,
      content,
      madeBy: input.madeBy ?? 'upload',
      previousId: input.previousId ?? null,
      createdBy: input.userId,
    })
    .returning();
  return row!;
}
