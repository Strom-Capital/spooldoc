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

/** How an SFTP destination signs in: with a key Spooldoc makes, a key of your own, or a password. */
export const SFTP_AUTH = ['spooldoc-key', 'own-key', 'password'] as const;
export type SftpAuth = (typeof SFTP_AUTH)[number];

/** The kinds of key Spooldoc makes. Ed25519 by default; RSA for servers that refuse it. */
export const SFTP_KEY_TYPES = ['ed25519', 'rsa'] as const;
export type SftpKeyType = (typeof SFTP_KEY_TYPES)[number];

/**
 * A host name or IP address of an SFTP server, without a scheme, a user or a port:
 * `sftp.example.com`, `192.0.2.10`, `2001:db8::10`.
 */
export const sftpHost = z
  .string()
  .trim()
  .min(1, 'Enter the server')
  .max(253, 'Use a host name of at most 253 characters')
  .refine((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value), 'Enter the host name only, without sftp:// or another scheme')
  .refine((value) => !value.includes('@'), 'Enter the host name only. The user goes in User')
  .refine((value) => /^[A-Za-z0-9._-]+$/.test(value) || /^\[?[0-9A-Fa-f:.]+\]?$/.test(value), 'Enter a host name or IP address, such as sftp.example.com. The port goes in its own field')
  .transform((value) => value.replace(/^\[(.*)\]$/, '$1'));

/**
 * A folder on an SFTP server: absolute, or relative to the user's home folder. Without
 * `.` or `..` parts and control characters. A trailing `/` is dropped, and `//` becomes `/`.
 */
export const sftpFolder = z
  .string()
  .trim()
  .min(1, 'Enter the folder')
  .max(1000, 'Use a folder of at most 1000 characters')
  .transform((value) => value.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'))
  .refine((value) => !value.split('/').some((part) => part === '..' || part === '.'), 'Enter the folder without . or .. parts')
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Enter the folder without control characters');

/** The most entries Spooldoc reads of a folder on an SFTP server. */
export const SFTP_LIST_LIMIT = 5000;

/** A host key Spooldoc trusts: its SSH type, such as `ssh-ed25519`, and the key itself in base64. */
export const sftpHostKeySchema = z.object({
  type: z.string().min(1).max(100),
  key: z.string().min(1).max(4000).regex(/^[A-Za-z0-9+/]+=*$/),
});
export type SftpHostKey = z.infer<typeof sftpHostKeySchema>;

/**
 * The settings of an SFTP destination. The private key, its passphrase and the password
 * are kept encrypted apart from these. `publicKey` is the OpenSSH line of the key it signs
 * in with, which is not secret. `hostKey` is the host key Spooldoc trusts, set only through
 * Check connection; a run against a destination without one fails at once.
 */
export const sftpConfigSchema = z.object({
  host: sftpHost,
  port: z.coerce.number().int('Enter a port from 1 to 65535').min(1, 'Enter a port from 1 to 65535').max(65535, 'Enter a port from 1 to 65535').default(22),
  username: z
    .string()
    .trim()
    .min(1, 'Enter the user')
    .max(100, 'Use a user of at most 100 characters')
    .refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value), 'Enter the user without spaces'),
  auth: z.enum(SFTP_AUTH).default('spooldoc-key'),
  publicKey: z.string().max(4000).nullable().default(null),
  folder: sftpFolder,
  testFolder: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => value || null)
    .pipe(sftpFolder.nullable()),
  ifExists: z.enum(IF_EXISTS).default('replace'),
  keepCopy: z.boolean().default(true),
  tempName: z.boolean().default(true),
  hostKey: sftpHostKeySchema.nullable().default(null),
});
export type SftpConfig = z.infer<typeof sftpConfigSchema>;

/** A host key as `ssh-keygen -l` prints it: the type, the bits and the SHA256 fingerprint. */
export interface HostKeyInfo {
  /** As `ssh-keygen -l` names it: ED25519, RSA, ECDSA or DSA. */
  type: string;
  bits: number;
  /** `SHA256:` and the base64 of the key's hash, without padding. */
  fingerprint: string;
}

/**
 * An SFTP destination as the pages see it: the settings with the trusted host key as its
 * fingerprint, the fingerprint of the key it signs in with, and whether a key or a
 * password is saved. Never the secrets.
 */
export interface SftpConfigView extends Omit<SftpConfig, 'hostKey'> {
  hostKey: HostKeyInfo | null;
  /** The key it signs in with, from `publicKey`. */
  key: HostKeyInfo | null;
  hasKey: boolean;
  hasPassword: boolean;
}

/** Where an SFTP destination puts the files: `MYUSER@sftp.example.com:/in/invoices`. */
export function sftpTarget(config: Pick<SftpConfig, 'host' | 'username' | 'folder'>): string {
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  return `${config.username}@${host}:${config.folder}`;
}

/** The server of an SFTP destination, with its port when it is not 22: `sftp.example.com` or `sftp.example.com port 2222`. */
export const sftpServer = (config: Pick<SftpConfig, 'host' | 'port'>): string => (config.port === 22 ? config.host : `${config.host} port ${config.port}`);

/** The settings schema of each kind a user can add. */
export const CONFIG_SCHEMAS = { ifs: ifsConfigSchema, email: emailConfigSchema, webhook: webhookConfigSchema, sftp: sftpConfigSchema } as const;

/** Where a destination puts the files, and how: for the Destinations page and the job editor. `test` is set in test mode. */
export function destinationText(
  destination:
    | { kind: 'spooldoc' }
    | { kind: 'ifs'; config: IfsConfig }
    | { kind: 'email'; config: EmailConfig }
    | { kind: 'webhook'; config: WebhookConfigView }
    | { kind: 'sftp'; config: SftpConfigView },
): { where: string; how: string; test?: string } {
  if (destination.kind === 'sftp') {
    const { folder, testFolder, username, ifExists, keepCopy } = destination.config;
    return {
      where: `Uploaded to ${folder} on ${sftpServer(destination.config)} as ${username}.`,
      how: `${IF_EXISTS_TEXT[ifExists]} ${keepCopy ? 'A copy is kept in Spooldoc.' : 'No copy is kept in Spooldoc.'}`,
      ...(testFolder ? { test: `Test: all files go to ${testFolder}.` } : {}),
    };
  }
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

/**
 * The secrets a request gives an SFTP destination. A field left out keeps the saved value,
 * where the rules allow it.
 */
export const sftpSecretsInput = z.object({
  password: z.string().max(1000, 'Use a password of at most 1000 characters').optional(),
  privateKey: z.string().max(20_000, 'Paste a private key of at most 20,000 characters').optional(),
  passphrase: z.string().max(1000, 'Use a passphrase of at most 1000 characters').optional(),
});
export type SftpSecretsInput = z.infer<typeof sftpSecretsInput>;

/** A destination name. */
export const destinationName = z.string().trim().min(1, 'Enter a name').max(80, 'Use a name of at most 80 characters');

/** The kinds a user can add. The built-in `spooldoc` destination cannot be added. */
export const createDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ifs'), name: destinationName, config: ifsConfigSchema }),
  z.object({ kind: z.literal('email'), name: destinationName, config: emailConfigSchema }),
  z.object({ kind: z.literal('webhook'), name: destinationName, config: webhookConfigSchema, headers: webhookHeadersSchema.default([]) }),
  z.object({
    kind: z.literal('sftp'),
    name: destinationName,
    config: sftpConfigSchema,
    secrets: sftpSecretsInput.default({}),
    sealedKey: z.string().max(20_000).optional(),
    hostKeyToken: z.string().max(10_000).nullable().optional(),
  }),
]);

/**
 * A change to a destination: its name and settings. The kind stays, so the route checks
 * the settings against it. A webhook also takes its headers and `rotateSecret`; an SFTP
 * destination its new secrets, a key Spooldoc made (`sealedKey`) and the host key it
 * trusts, as the token from Check connection.
 */
export const updateDestinationSchema = z
  .object({
    name: destinationName,
    config: z.record(z.string(), z.unknown()),
    headers: webhookHeadersChangeSchema,
    rotateSecret: z.boolean(),
    secrets: sftpSecretsInput,
    sealedKey: z.string().max(20_000),
    hostKeyToken: z.string().max(10_000).nullable(),
  })
  .partial();
