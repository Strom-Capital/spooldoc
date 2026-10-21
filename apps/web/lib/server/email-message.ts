import 'server-only';

import { namePatternProblems, tagProblems, templatePaths, valueAt, type Definition, type ValueType } from '@spooldoc/core';
import { convert as convertHtml } from 'html-to-text';
import juice from 'juice';
import type { SendMailOptions } from 'nodemailer';
import { isEmailAddress } from '@/lib/destination-config';
import { EMAIL_FIELDS, EMAIL_TAG, parseEmailTag, type EmailField, type EmailTag } from '@/lib/email-fields';
import { DEFAULT_FORMATS, formatC, formatD, formatN, formatPlainNumber, type Formats } from '@/lib/formats';
import { FORMAT_FILES, formatList, perSpooledFile, type EmailSpec, type Format, type JobTemplate } from '@/lib/job-spec';
import type { EmailSegment, EmailValueState } from '@/lib/types';

/**
 * What is wrong with a job's email part before it runs, one line each: tags that are not
 * fields of the definition, formatters other than formatN, formatC and formatD or with a
 * wrong argument, a message template that is gone or not
 * HTML, formats under Attach that no template makes, and `{d.pg...}` tags in the email of
 * the whole spooled file, which has no page group.
 */
export function emailSpecProblems(spec: EmailSpec, def: Definition | null, templates: JobTemplate[]): string[] {
  const problems: string[] = [];
  if (!spec.to.trim()) problems.push('Enter To, the address each email goes to.');
  const known = def ? templatePaths(def) : undefined;
  const fields = (Object.keys(EMAIL_FIELDS) as EmailField[]).filter((field) => field !== 'body' || spec.bodyTemplateId === null);
  for (const field of fields) {
    const text = spec[field];
    const label = EMAIL_FIELDS[field];
    const seen = new Set<string>();
    // Tags an email field cannot read say why; the rest are checked without their formatters, like a file name.
    const tagged: string[] = [];
    const plain = text.replace(EMAIL_TAG, (tag) => {
      const read = parseEmailTag(tag);
      if (!read.ok) {
        tagged.push(read.problem);
        return '';
      }
      return `{d.${read.path}}`;
    });
    for (const problem of [...tagged, ...namePatternProblems(plain), ...tagProblems(plain, known).map((p) => p.message)]) {
      if (!seen.has(problem)) problems.push(`${label}: ${problem}`);
      seen.add(problem);
    }
  }
  if (spec.bodyTemplateId !== null) {
    const template = templates.find((t) => t.id === spec.bodyTemplateId);
    if (!template) problems.push('The message template is not a template of the job any more. Pick another one, or write the message.');
    else if (template.kind !== 'html') problems.push(`The message template ${template.name} is not an HTML template. Pick an HTML template, or write the message.`);
  }
  const made = new Set(templates.flatMap((template) => template.formats));
  const missing = spec.attach.filter((format) => !made.has(format));
  if (missing.length > 0) problems.push(`Attach picks ${formatList(missing)}, which no template of the job makes.`);
  const wholeFile = templates.some((template) => perSpooledFile(template) && template.formats.some((format) => spec.attach.includes(format)));
  if (wholeFile) {
    const pgFields = fields.filter((field) => /\{d\.pg[.[]/.test(spec[field])).map((field) => EMAIL_FIELDS[field]);
    if (pgFields.length > 0) {
      problems.push(
        `${pgFields.join(', ')} ${pgFields.length === 1 ? 'reads' : 'read'} {d.pg...}, but the email of the whole spooled file has no page group. Use {d.splf...} there, or attach no file of the whole spooled file.`,
      );
    }
  }
  return problems;
}

/** A file that goes with an email. */
export interface EmailFile {
  name: string;
  contentType: string;
  content: Uint8Array;
}

/** The state of a value: `missing` when the data has no such path, `empty` when it has nothing to print. */
function stateOf(value: unknown, present: boolean): EmailValueState {
  if (!present) return 'missing';
  if (value === null || value === undefined || typeof value === 'object' || String(value).trim() === '') return 'empty';
  return 'found';
}

/** True when the data has the path, even with an empty value. */
function hasPath(data: unknown, path: string): boolean {
  const cut = path.lastIndexOf('.');
  const parent = cut === -1 ? data : valueAt(data, path.slice(0, cut));
  const key = path.slice(cut + 1).replace(/\[\d+\]$/, '');
  return parent !== null && typeof parent === 'object' && key in parent;
}

/** How email fields print values: the Formats of Settings, and the type of each field of the definition. */
export interface EmailFormatting {
  formats: Formats;
  /** The type of each typed field, by path such as `pg.dueDate`. */
  types: Record<string, ValueType>;
}

/** The defaults of Settings, with no field types. */
export const PLAIN_FORMATTING: EmailFormatting = { formats: DEFAULT_FORMATS, types: {} };

/** The type of each field of a definition that has one, by path: `pg.dueDate` is `date`. */
export function fieldTypes(def: Definition | null): Record<string, ValueType> {
  const types: Record<string, ValueType> = { 'splf.number': 'number' };
  if (def?.source === 'text' && def.text) {
    for (const field of def.text.fields ?? []) if (field.type) types[`pg.${field.name}`] = field.type;
  } else if (def?.xml) {
    for (const [name, value] of Object.entries(def.xml.fields ?? {})) if (typeof value === 'object' && value.type) types[`pg.${name}`] = value.type;
  }
  return types;
}

/**
 * A value as an email field prints it, by the rules templates follow: `formatN`,
 * `formatC` and `formatD` as Carbone prints them with the Formats of Settings; without a
 * formatter, a date field in the date format of Settings and a number with its own
 * decimals and the separators of Settings. Null when there is nothing to print, such as
 * a date that is not one.
 */
function printed(value: unknown, tag: Extract<EmailTag, { ok: true }>, formatting: EmailFormatting): string | null {
  const { formats } = formatting;
  const lang = formats.numberFormat;
  if (tag.formatter === 'formatN') return formatN(value, tag.decimals ?? 3, lang);
  if (tag.formatter === 'formatC') return formatC(value, tag.decimals ?? 2, formats);
  if (tag.formatter === 'formatD') return formatD(value, tag.pattern, lang);
  if (formatting.types[tag.path] === 'date') return formatD(value, formats.dateFormat, lang);
  if (typeof value === 'number') return formatPlainNumber(value, lang);
  return String(value).trim();
}

/** A field's text in pieces, with each tag filled in from the document's data. A tag an email field cannot read prints nothing. */
export function expandSegments(text: string, data: unknown, formatting: EmailFormatting = PLAIN_FORMATTING): EmailSegment[] {
  const segments: EmailSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(EMAIL_TAG)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    const tag = parseEmailTag(match[0]);
    if (!tag.ok) {
      segments.push({ text: '', tag: match[0], state: 'missing' });
    } else {
      const value = valueAt(data, tag.path);
      let state = stateOf(value, hasPath(data, tag.path));
      const shown = state === 'found' ? printed(value, tag, formatting) : null;
      if (state === 'found' && !shown) state = 'empty';
      segments.push({ text: shown ?? '', tag: match[0], state });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** A field with its tags filled in, and the tags that had no value: empty ones, and ones not in the data. */
export function expandText(text: string, data: unknown, formatting: EmailFormatting = PLAIN_FORMATTING): { text: string; empty: string[]; missing: string[] } {
  const segments = expandSegments(text, data, formatting);
  const tags = (state: EmailValueState) => [...new Set(segments.filter((segment) => segment.tag && segment.state === state).map((segment) => segment.tag!))];
  return { text: segments.map((segment) => segment.text).join(''), empty: tags('empty'), missing: tags('missing') };
}

/** Why tags have no value, for a message: "{d.pg.email} is empty", "{d.pg.emial} is not in the data". */
function emptyText(expanded: { empty: string[]; missing: string[] }): string {
  const say = (tags: string[], what: string) => (tags.length === 0 ? [] : [`${tags.join(' and ')} ${tags.length === 1 ? 'is' : 'are'} ${what}`]);
  return [...say(expanded.empty, 'empty'), ...say(expanded.missing, 'not in the data')].join(', and ');
}

/**
 * The addresses of To, Cc, Bcc or Reply-To: the field with its tags filled in, split at
 * commas and semicolons, with the tags that had no value and the text that is not an
 * address.
 */
export function addressList(text: string, data: unknown, formatting: EmailFormatting = PLAIN_FORMATTING): { addresses: string[]; empty: string[]; missing: string[]; invalid: string[] } {
  const expanded = expandText(text, data, formatting);
  const parts = expanded.text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return { addresses: parts.filter(isEmailAddress), empty: expanded.empty, missing: expanded.missing, invalid: parts.filter((part) => !isEmailAddress(part)) };
}

/**
 * What keeps the email from being sent, from its address fields. To must have an address
 * and every tag in it a value: a customer whose address is empty would not get the
 * document. Cc, Bcc and Reply-To are optional, so a tag with no value there is left out.
 * Text that is not an address fails in every field.
 */
export function addressProblems(spec: Pick<EmailSpec, 'to' | 'cc' | 'bcc' | 'replyTo'>, data: unknown, formatting: EmailFormatting = PLAIN_FORMATTING): string[] {
  const to = addressList(spec.to, data, formatting);
  const problems: string[] = [];
  if (to.empty.length > 0 || to.missing.length > 0) problems.push(emptyText(to));
  else if (to.addresses.length === 0 && to.invalid.length === 0) problems.push('To has no address');
  const fields = [['To', to], ['Cc', addressList(spec.cc, data, formatting)], ['Bcc', addressList(spec.bcc, data, formatting)], ['Reply-To', addressList(spec.replyTo, data, formatting)]] as const;
  for (const [label, list] of fields) {
    for (const part of list.invalid) problems.push(`"${part}" in ${label} is not an email address`);
  }
  if (fields[3][1].addresses.length > 1) problems.push('Reply-To takes one address');
  return problems;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The plain message as HTML: paragraphs at blank lines, line breaks kept. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p style="margin:0 0 1em">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">\n${paragraphs}\n</body></html>`;
}

/**
 * The text of an HTML body, for the plain-text part of the email, read by an HTML parser:
 * no line wrapping, tables kept as columns, headings as they are written, images left out
 * (they are data URIs or inline attachments), and a link's address after its text unless
 * it is the text itself.
 */
export function htmlToText(html: string): string {
  return convertHtml(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false, noAnchorUrl: true } },
      { selector: 'table', format: 'dataTable' },
      ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((selector) => ({ selector, options: { uppercase: false } })),
    ],
  }).trim();
}

/**
 * An HTML template's output as an email body: its CSS inlined, since many mail programs
 * drop `<style>`. Images stay data URIs here; `attachDataUrls` turns them into inline
 * CID attachments when the email is sent, since Gmail blocks data URIs.
 */
export function inlineHtml(html: string): string {
  return juice(html, { removeStyleTags: true, preserveMediaQueries: true, preserveFontFaces: false });
}

/** The line at the top of a test email: where it would have gone. */
function testLine(wouldGoTo: string[]): string {
  return `Test email from Spooldoc. Without the test address it would go to ${wouldGoTo.join(', ') || 'no address'}.`;
}

/** Puts a block right after `<body>`, or in front when there is none. */
function afterBody(html: string, block: string): string {
  const open = /<body[^>]*>/i.exec(html);
  if (!open) return block + html;
  const at = open.index + open[0].length;
  return html.slice(0, at) + block + html.slice(at);
}

/** The formats a job's files can be attached in, from their content type. */
export function formatOf(contentType: string): Format | undefined {
  return (Object.keys(FORMAT_FILES) as Format[]).find((format) => FORMAT_FILES[format].contentType === contentType);
}

/** The subject: the field with its tags filled in, or the document's name when it comes out empty; `[Test]` in front for a test send. */
export function emailSubject(spec: Pick<EmailSpec, 'subject'>, data: unknown, document: string, test: boolean, formatting: EmailFormatting = PLAIN_FORMATTING): string {
  const subject = expandText(spec.subject, data, formatting).text.replace(/\s+/g, ' ').trim() || document;
  return test ? `[Test] ${subject}` : subject;
}

/**
 * The message as HTML and as plain text: the job's text with its tags filled in, or the
 * HTML of its message template with the CSS inlined. With `wouldGoTo` (a test send), a
 * line at the top names the addresses it would have gone to.
 */
export function messageBody(input: {
  spec: Pick<EmailSpec, 'body'>;
  data: unknown;
  templateHtml?: string | null;
  wouldGoTo: string[] | null;
  formatting?: EmailFormatting;
}): { html: string; text: string } {
  let html: string;
  let text: string;
  if (input.templateHtml) {
    html = inlineHtml(input.templateHtml);
    text = htmlToText(html);
  } else {
    const body = expandText(input.spec.body, input.data, input.formatting).text;
    html = textToHtml(body);
    text = body.trim();
  }
  if (input.wouldGoTo) {
    const line = testLine(input.wouldGoTo);
    html = afterBody(
      html,
      `<p style="margin:0 0 16px;padding:8px 12px;background:#fff4d6;color:#5c4400;font-family:Arial,Helvetica,sans-serif;font-size:13px;border-radius:4px">${escapeHtml(line)}</p>`,
    );
    text = `${line}\n\n${text}`;
  }
  return { html, text };
}

/** What `composeEmail` needs for one document. */
export interface ComposeInput {
  spec: EmailSpec;
  /** The document's data: `{ pg, splf }` for a page group, `{ pgs, splf }` for the whole spooled file. */
  data: unknown;
  /** The document's file name without extension, the subject when the job sets none. */
  document: string;
  /** Every file of the document; the ones in `spec.attach` go with the email. */
  files: EmailFile[];
  from: SendMailOptions['from'];
  testAddress: string | null;
  /** The HTML output of the job's body template for this document, when the message is a template. */
  templateHtml?: string | null;
  /** How fields print numbers, amounts and dates. */
  formatting?: EmailFormatting;
}

/** An email ready to send, and what the job log keeps of it. */
export interface ComposedEmail {
  message: SendMailOptions;
  /** The addresses it is for, from To, before a test address. */
  to: string[];
  subject: string;
  html: string;
  attachments: EmailFile[];
}

/**
 * The email of one document: To, Cc, Bcc and Reply-To with their tags filled in, the
 * subject, the message (the plain text with fields, or a template's HTML with its CSS
 * inlined), a plain-text version, and the document's files in the formats picked under
 * Attach. With a test address, it goes only there, without Cc and Bcc, with `[Test]`
 * in front of the subject and a line at the top that says where it would have gone.
 *
 * @returns The email, or the problems that keep it from being sent, such as an empty To
 */
export function composeEmail(input: ComposeInput): { email: ComposedEmail; problems: [] } | { email: null; problems: string[] } {
  const { spec, data } = input;
  const formatting = input.formatting ?? PLAIN_FORMATTING;
  const problems = addressProblems(spec, data, formatting);
  if (problems.length > 0) return { email: null, problems };
  const to = addressList(spec.to, data, formatting);
  const cc = addressList(spec.cc, data, formatting);
  const bcc = addressList(spec.bcc, data, formatting);
  const replyTo = addressList(spec.replyTo, data, formatting);

  const test = input.testAddress;
  const subject = emailSubject(spec, data, input.document, test !== null, formatting);
  const { html, text } = messageBody({ spec, data, templateHtml: input.templateHtml, wouldGoTo: test ? to.addresses : null, formatting });
  const attachments = input.files.filter((file) => {
    const format = formatOf(file.contentType);
    return format !== undefined && spec.attach.includes(format);
  });
  const message: SendMailOptions = {
    from: input.from,
    to: test ? [test] : to.addresses,
    ...(!test && cc.addresses.length > 0 ? { cc: cc.addresses } : {}),
    ...(!test && bcc.addresses.length > 0 ? { bcc: bcc.addresses } : {}),
    ...(replyTo.addresses[0] ? { replyTo: replyTo.addresses[0] } : {}),
    subject,
    html,
    text,
    attachDataUrls: true,
    attachments: attachments.map((file) => ({ filename: file.name, content: Buffer.from(file.content), contentType: file.contentType })),
  };
  return { email: { message, to: to.addresses, subject, html, attachments }, problems: [] };
}
