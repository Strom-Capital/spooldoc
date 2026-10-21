// The email fields of a job's destination step, shared by the editor and the server.

/** The fields of an email that take `{d.pg.field}` tags, and their labels. */
export const EMAIL_FIELDS = { to: 'To', cc: 'Cc', bcc: 'Bcc', replyTo: 'Reply-To', subject: 'Subject', body: 'Message' } as const;
export type EmailField = keyof typeof EMAIL_FIELDS;

/** Every tag of `d` in a field's text, valid or not, such as `{d.pg.email}` or `{d.pg.total:formatC(2)}`. */
export const EMAIL_TAG = /\{d[.[][^{}]*\}/g;

/** The formatters an email field takes, as in templates. */
export const EMAIL_FORMATTERS = ['formatN', 'formatC', 'formatD'] as const;
export type EmailFormatter = (typeof EMAIL_FORMATTERS)[number];

/** What the editor and the save check say about a formatter an email field does not take. */
export const FORMATTERS_TEXT = "Email fields take formatN, formatC and formatD, such as {d.pg.totalAmount:formatC(2)} or {d.pg.dueDate:formatD('DD.MM.YYYY')}.";

/** A tag of an email field, read: its path, and its formatter with the formatter's argument. */
export type EmailTag =
  | { ok: true; path: string; formatter: null }
  | { ok: true; path: string; formatter: 'formatN' | 'formatC'; decimals: number | null }
  | { ok: true; path: string; formatter: 'formatD'; pattern: string }
  | { ok: false; path: string | null; problem: string };

const TAG = /^\{d\.([A-Za-z_][\w.[\]]*)(?::([A-Za-z]\w*)(?:\(([^()]*)\))?)?\}$/;

/**
 * Reads one tag. A plain path, or a path with `formatN(decimals)`, `formatC(decimals)`
 * (0 to 10 decimals, or none for the default) or `formatD('pattern')`. Anything else is a
 * problem that says what email fields take.
 */
export function parseEmailTag(tag: string): EmailTag {
  const match = TAG.exec(tag);
  if (!match) {
    return { ok: false, path: null, problem: `${tag} is not a tag an email field can read. Write a field as {d.pg.invoiceNo}, with one formatter at most. ${FORMATTERS_TEXT}` };
  }
  const [, path = '', name, args] = match;
  if (!name) return { ok: true, path, formatter: null };
  if (name === 'formatN' || name === 'formatC') {
    const text = (args ?? '').trim();
    if (text === '') return { ok: true, path, formatter: name, decimals: null };
    if (!/^\d{1,2}$/.test(text) || Number(text) > 10) {
      return { ok: false, path, problem: `${tag}: ${name} takes a number of decimals from 0 to 10, such as ${name}(2).` };
    }
    return { ok: true, path, formatter: name, decimals: Number(text) };
  }
  if (name === 'formatD') {
    const pattern = /^\s*'([^']+)'\s*$/.exec(args ?? '')?.[1];
    if (!pattern) return { ok: false, path, problem: `${tag}: formatD takes a pattern in single quotes, such as formatD('DD.MM.YYYY').` };
    return { ok: true, path, formatter: 'formatD', pattern };
  }
  return { ok: false, path, problem: `${tag} uses ${name}. ${FORMATTERS_TEXT}` };
}

/** A piece of a field's text: plain text, or a tag with its path. */
export interface TagSegment {
  text: string;
  /** The tag's path without `d.`, such as `pg.email`; missing for plain text. */
  path?: string;
}

/** A field's text in pieces, so the editor can show each tag as a chip. */
export function tagSegments(text: string): TagSegment[] {
  const segments: TagSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(EMAIL_TAG)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ text: match[0], path: parseEmailTag(match[0]).path ?? match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
