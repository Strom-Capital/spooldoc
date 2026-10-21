import { z } from 'zod';

/** What an IFS destination does when the folder has a file with the same name. */
export const IF_EXISTS = ['replace', 'fail', 'suffix'] as const;
export type IfExists = (typeof IF_EXISTS)[number];

/** The words for each choice, in the dialog and the job editor. */
export const IF_EXISTS_LABEL: Record<IfExists, string> = {
  replace: 'Replace',
  fail: 'Fail the run',
  suffix: 'Add a number',
};

/**
 * An IFS folder: an absolute path, without `..` and not in the library file system. A
 * trailing `/` is dropped, and `//` becomes `/`.
 */
export const ifsFolder = z
  .string()
  .trim()
  .min(1, 'Enter the folder')
  .max(1000, 'Use a folder of at most 1000 characters')
  .refine((value) => value.startsWith('/'), 'Enter a folder that starts with /, such as /home/docs/out')
  .transform((value) => value.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'))
  .refine((value) => value !== '/', 'Pick a folder below /')
  .refine((value) => !value.split('/').some((part) => part === '..' || part === '.'), 'Enter the folder without . or .. parts')
  .refine((value) => !/^\/qsys\.lib(\/|$)/i.test(value), 'Pick a folder outside /QSYS.LIB; it holds libraries, not files')
  .refine((value) => !/[\u0000-\u001f]/.test(value), 'Enter the folder without control characters');

/** The settings of an IFS destination. */
export const ifsConfigSchema = z.object({
  folder: ifsFolder,
  ifExists: z.enum(IF_EXISTS).default('replace'),
  keepCopy: z.boolean().default(true),
});
export type IfsConfig = z.infer<typeof ifsConfigSchema>;

/** What happens to a file with the same name, as a sentence. */
export const IF_EXISTS_TEXT: Record<IfExists, string> = {
  replace: 'A file with the same name is replaced.',
  fail: 'A file with the same name fails the run, and no file is replaced.',
  suffix: 'A file with the same name gets a number added, such as invoice-1001-2.pdf.',
};

/**
 * One email address, such as buyer@example.com: something before and after one @, a dot
 * in the domain, and no spaces, commas or angle brackets.
 */
const EMAIL_ADDRESS = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\].]{2,}$/;

/** True for one valid email address. */
export const isEmailAddress = (value: string): boolean => EMAIL_ADDRESS.test(value) && !value.includes('..');

/**
 * The settings of an email destination. While `testAddress` is set, every email goes only
 * there. To, Subject and the message are set per job, in `spec.destination.email`.
 */
export const emailConfigSchema = z.object({
  testAddress: z
    .string()
    .trim()
    .max(320, 'Use an address of at most 320 characters')
    .refine((value) => value === '' || isEmailAddress(value), 'Enter one address, such as you@example.com')
    .nullable()
    .default(null)
    .transform((value) => value || null),
});
export type EmailConfig = z.infer<typeof emailConfigSchema>;

/** The message of each problem with a webhook URL. */
function webhookUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a full URL, such as https://hooks.example.com/spooldoc';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Enter a URL that starts with https:// or http://';
  if (url.username || url.password) return 'Enter the URL without a user name or password. Send credentials in a header';
  if (value.includes('#')) return 'Enter the URL without a # part; it is not sent';
  return null;
}

/** A URL a webhook posts to: http or https, without a user, a password or a `#` part. */
export const webhookUrl = z
  .string()
  .trim()
  .min(1, 'Enter the URL')
  .max(2000, 'Use a URL of at most 2000 characters')
  .superRefine((value, ctx) => {
    const problem = webhookUrlProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/**
 * The settings of a webhook destination. While `testUrl` is set, every call goes there
 * instead of `url`, marked as a test and without the custom headers. The signing secret
 * and the header values are kept encrypted apart from these settings.
 */
export const webhookConfigSchema = z.object({
  url: webhookUrl,
  testUrl: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => value || null)
    .pipe(webhookUrl.nullable()),
});
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

/** A webhook destination as the pages see it: the header names and whether it signs, never the values. */
export interface WebhookConfigView extends WebhookConfig {
  headers: { name: string }[];
  hasSecret: boolean;
}

/** How long Spooldoc waits for a receiver to answer a call. */
export const WEBHOOK_TIMEOUT_SECONDS = 30;

/** The headers Spooldoc sets itself on every call, so a destination cannot set them. */
export const isReservedHeader = (name: string): boolean => /^(host|content-type|content-length|user-agent|webhook-.*)$/i.test(name);

/** A header name: HTTP token characters only. */
export const headerName = z
  .string()
  .trim()
  .min(1, 'Enter the header name')
  .max(100, 'Use a header name of at most 100 characters')
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Enter a header name of letters, digits and - only, such as Authorization')
  .refine((value) => !isReservedHeader(value), 'Pick another header name. Spooldoc sets Host, Content-Type, Content-Length, User-Agent and the webhook- headers itself');

/** A header value: one line, without control characters. */
const headerValue = z
  .string()
  .max(4000, 'Use a header value of at most 4000 characters')
  .refine((value) => !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value), 'Enter the header value on one line, without control characters');

/** True when no two headers have the same name, in any case. */
const uniqueNames = (headers: { name: string }[]) => new Set(headers.map((header) => header.name.toLowerCase())).size === headers.length;
const UNIQUE = 'Give each header a different name';

/** The headers of a new webhook destination, with their values. */
export const webhookHeadersSchema = z
  .array(z.object({ name: headerName, value: headerValue.refine((value) => value.trim() !== '', 'Enter the header value') }))
  .max(20, 'Use at most 20 headers')
  .refine(uniqueNames, UNIQUE);

/** The headers of a changed webhook destination. A null value keeps the saved one; a header left out is removed. */
export const webhookHeadersChangeSchema = z
  .array(z.object({ name: headerName, value: headerValue.nullable() }))
  .max(20, 'Use at most 20 headers')
  .refine(uniqueNames, UNIQUE);

/**
 * Where a URL goes, without the scheme and the query string, which can hold a token:
 * `hooks.example.com/spooldoc`.
 */
export function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return value.replace(/^[a-z]+:\/\//i, '').replace(/[?#].*$/, '');
  }
}

/** A URL without its query string and `#` part, to store and show. */
export function urlWithoutQuery(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.replace(/[?#].*$/, '');
  }
}

/** "1 header", "3 headers". */
export const nHeaders = (n: number): string => `${n} ${n === 1 ? 'header' : 'headers'}`;

/** The settings schema of each kind a user can add. */
export const CONFIG_SCHEMAS = { ifs: ifsConfigSchema, email: emailConfigSchema, webhook: webhookConfigSchema } as const;

/** Where a destination puts the files, and how: for the Destinations page and the job editor. */
export function destinationText(
  destination: { kind: 'spooldoc' } | { kind: 'ifs'; config: IfsConfig } | { kind: 'email'; config: EmailConfig } | { kind: 'webhook'; config: WebhookConfigView },
): { where: string; how: string } {
  if (destination.kind === 'webhook') {
    const { url, testUrl, headers, hasSecret } = destination.config;
    const how = [hasSecret ? 'Signed' : 'Not signed', ...(headers.length > 0 ? [nHeaders(headers.length)] : [])].join(', ');
    return {
      where: `POST to ${shortUrl(url)}, one call per document.`,
      how: testUrl ? `Test: all calls go to ${shortUrl(testUrl)}, without the headers.` : `${how}.`,
    };
  }
  if (destination.kind === 'email') {
    const { testAddress } = destination.config;
    return {
      where: 'Sent by email, one email per document.',
      how: testAddress ? `Test: all email goes to ${testAddress}.` : 'Each job sets To, Subject and the message.',
    };
  }
  if (destination.kind === 'ifs') {
    const { folder, ifExists, keepCopy } = destination.config;
    return {
      where: `Written to ${folder} on the job's server.`,
      how: `${IF_EXISTS_TEXT[ifExists]} ${keepCopy ? 'A copy is kept in Spooldoc.' : 'No copy is kept in Spooldoc.'}`,
    };
  }
  return { where: "Kept in Spooldoc's database.", how: 'Download the files from the Job log, or from Run now.' };
}

/** A destination name. */
export const destinationName = z.string().trim().min(1, 'Enter a name').max(80, 'Use a name of at most 80 characters');

/** The kinds a user can add. The built-in `spooldoc` destination cannot be added. */
export const createDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ifs'), name: destinationName, config: ifsConfigSchema }),
  z.object({ kind: z.literal('email'), name: destinationName, config: emailConfigSchema }),
  z.object({ kind: z.literal('webhook'), name: destinationName, config: webhookConfigSchema, headers: webhookHeadersSchema.default([]) }),
]);

/**
 * A change to a destination: its name and settings. The kind stays, so the route checks
 * the settings against it. A webhook also takes its headers and `rotateSecret`.
 */
export const updateDestinationSchema = z
  .object({ name: destinationName, config: z.record(z.string(), z.unknown()), headers: webhookHeadersChangeSchema, rotateSecret: z.boolean() })
  .partial();
