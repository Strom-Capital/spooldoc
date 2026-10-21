// The email fields of a job's destination step, shared by the editor and the server.

/** The fields of an email that take `{d.pg.field}` tags, and their labels. */
export const EMAIL_FIELDS = { to: 'To', cc: 'Cc', bcc: 'Bcc', replyTo: 'Reply-To', subject: 'Subject', body: 'Message' } as const;
export type EmailField = keyof typeof EMAIL_FIELDS;

/** A tag in an email field: a plain path such as `{d.pg.email}`, without formatters, as in a file name pattern. */
export const EMAIL_TAG = /\{d\.([A-Za-z_][\w.[\]]*)\}/g;

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
    segments.push({ text: match[0], path: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
