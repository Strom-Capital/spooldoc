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

/** The settings schema of each kind a user can add. */
export const CONFIG_SCHEMAS = { ifs: ifsConfigSchema, email: emailConfigSchema } as const;

/** Where a destination puts the files, and how: for the Destinations page and the job editor. */
export function destinationText(
  destination: { kind: 'spooldoc' } | { kind: 'ifs'; config: IfsConfig } | { kind: 'email'; config: EmailConfig },
): { where: string; how: string } {
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
]);

/** A change to a destination: its name and settings. The kind stays, so the route checks the settings against it. */
export const updateDestinationSchema = z.object({ name: destinationName, config: z.record(z.string(), z.unknown()) }).partial();
