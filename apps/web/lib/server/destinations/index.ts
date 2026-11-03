import 'server-only';

import type { DocumentData, PageRange, ValueType } from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { emailConfigSchema, ifsConfigSchema, sftpConfigSchema, webhookConfigSchema } from '@/lib/destination-config';
import type { EmailSpec, JobTemplate, WebhookSpec } from '@/lib/job-spec';
import type { DestinationView } from '@/lib/types';
import { getDb } from '../db';
import { destinations } from '../db/schema';
import { emailDestination } from './email';
import { ifsDestination } from './ifs';
import { openSftpSecrets, sftpConfigView, sftpDestination } from './sftp';
import { openWebhookSecrets, webhookDestination } from './webhook';
import type { WebhookContext } from '../webhook-payload';
import { nFiles, type RunFile } from './store';

export { type RunFile } from './store';

/** A document of a run: its data, for a destination that fills in fields, such as email. */
export interface RunDocument {
  /** The page group; null for the document of the whole spooled file. */
  pageGroupIndex: number | null;
  /** The document's file name without extension, such as `invoice-260101`. */
  name: string;
  /**
   * The pages of the page group; null for the document of the whole spooled file. XML page
   * groups can share a page.
   */
  pages: PageRange | null;
  data: DocumentData;
  /** The HTML of the job's email body template for this document, when the email's message is one. */
  html?: string | null;
}

/** What a destination gets to deliver a run. */
export interface DeliverInput {
  runId: string;
  /** The files of `documents`. */
  files: RunFile[];
  /** The documents this destination delivers, in page group order; the whole spooled file's document last. */
  documents: RunDocument[];
  /**
   * Keep files in Spooldoc, for download from the Job log. Each file is stored once a run,
   * also when several destinations of its document keep it.
   */
  keepFiles(files: RunFile[]): Promise<void>;
  /** The job and the spooled file, for a destination that remembers what it delivered. */
  job: { id: string; splfKey: string };
  destinationId: string;
  /** The route that sends these documents here, counted from 1, recorded with each delivery. */
  route: number | null;
  /** The job's templates, for a destination that works out from them what a run sends, such as email. */
  templates: JobTemplate[];
  /** The job's email part, for an email destination. */
  email: EmailSpec | null;
  /** The job's webhook part, for a webhook destination. */
  webhook: WebhookSpec | null;
  /**
   * The job, the run and the spooled file, for a destination that describes them, such as a
   * webhook, with how many page groups the spooled file has in all.
   */
  context: WebhookContext & { pageGroups: number };
  /** The type of each typed field of the definition, by path such as `pg.dueDate`, for fields an email prints. */
  valueTypes: Record<string, ValueType>;
  /** The open connection of the job's server, and its host. */
  conn: Connection;
  host: string;
  /** Keep a secret, such as a password, out of the run's errors. */
  addSecret(secret: string): void;
}

/** Where a run's documents go. New kinds (such as S3) implement this. */
export interface Destination {
  kind: string;
  /**
   * Deliver the files of a run's documents. Runs outside any database transaction, since it
   * may write to another system; `keepFiles` saves files in one transaction of its own.
   *
   * @returns The deliver step's note, such as "Kept 3 files in Spooldoc"
   */
  deliver(input: DeliverInput): Promise<string>;
}

/** The built-in destination: files kept in Spooldoc's database for download. */
export const spooldocDestination: Destination = {
  kind: 'spooldoc',
  async deliver({ files, keepFiles }) {
    await keepFiles(files);
    return `Kept ${nFiles(files.length)} in Spooldoc`;
  },
};

type DestinationRow = Pick<typeof destinations.$inferSelect, 'name' | 'config' | 'secretsEnc'>;

/** Builds the destination of each kind from its saved settings. */
const KINDS: Record<string, (row: DestinationRow) => Destination> = {
  spooldoc: () => spooldocDestination,
  ifs: (row) => ifsDestination(ifsConfigSchema.parse(row.config)),
  email: (row) => emailDestination(emailConfigSchema.parse(row.config)),
  webhook: (row) => webhookDestination(webhookConfigSchema.parse(row.config), openWebhookSecrets(row.secretsEnc), row.name),
  sftp: (row) => sftpDestination(sftpConfigSchema.parse(row.config), openSftpSecrets(row.secretsEnc), row.name),
};

/** A destination row found for a run: its id, name and kind, and the destination it makes. */
export interface FoundDestination {
  id: string;
  name: string;
  kind: string;
  /**
   * The destination, built from the saved settings.
   *
   * @throws Error when the saved settings are not valid for the kind
   */
  open(): Destination;
}

/** The destination row behind an id, or null for an unknown id or kind. */
export async function destinationFor(id: string | null): Promise<FoundDestination | null> {
  if (!id) {
    return null;
  }
  const [row] = await getDb()
    .select({ kind: destinations.kind, name: destinations.name, config: destinations.config, secretsEnc: destinations.secretsEnc })
    .from(destinations)
    .where(eq(destinations.id, id));
  const build = row ? KINDS[row.kind] : undefined;
  if (!row || !build) {
    return null;
  }
  return { id, name: row.name, kind: row.kind, open: () => openDestination(row, build) };
}

/**
 * The destination of a row, built with its kind's builder.
 *
 * @throws Error when the saved settings are not valid for the kind
 */
function openDestination(row: DestinationRow & { kind: string }, build: (row: DestinationRow) => Destination): Destination {
  try {
    return build(row);
  } catch (error) {
    if (error instanceof Error && error.message.includes('SPOOLDOC_SECRET_KEY')) {
      if (row.kind === 'sftp') {
        throw new Error(`The key or password of the destination ${row.name} cannot be decrypted. Was SPOOLDOC_SECRET_KEY changed? Open it on the Destinations page, and make a new key or enter the password again.`);
      }
      throw new Error(`The secrets of the destination ${row.name} cannot be decrypted. Was SPOOLDOC_SECRET_KEY changed? Open it on the Destinations page, rotate the secret and enter the header values again.`);
    }
    throw new Error(`The settings of the destination ${row.name} are not valid. Open it on the Destinations page and save it again.`);
  }
}

/**
 * A destination row as the pages see it. IFS settings that are not valid show their folder
 * with the default choices, so the page can still list the destination and save it again.
 * A webhook shows its header names and whether it signs, never the secret or the values,
 * and an SFTP destination its public key and host key fingerprint, never its secrets.
 */
export function destinationView(row: typeof destinations.$inferSelect, jobs: DestinationView['jobs']): DestinationView {
  const base = { id: row.id, name: row.name, builtin: row.builtin, jobs };
  if (row.kind === 'ifs') {
    const parsed = ifsConfigSchema.safeParse(row.config);
    const config = parsed.success ? parsed.data : { folder: String(row.config.folder ?? ''), ifExists: 'replace' as const, keepCopy: true };
    return { ...base, kind: 'ifs', config };
  }
  if (row.kind === 'email') {
    const parsed = emailConfigSchema.safeParse(row.config);
    return { ...base, kind: 'email', config: parsed.success ? parsed.data : { testAddress: null } };
  }
  if (row.kind === 'webhook') {
    const parsed = webhookConfigSchema.safeParse(row.config);
    const config = parsed.success ? parsed.data : { url: String(row.config.url ?? ''), testUrl: null };
    let headers: { name: string }[] = [];
    let hasSecret = row.secretsEnc !== null;
    try {
      const secrets = openWebhookSecrets(row.secretsEnc);
      headers = secrets.headers.map(({ name }) => ({ name }));
      hasSecret = secrets.signingSecret !== null;
    } catch {
      // Secrets that cannot be decrypted show no headers; a run says why.
    }
    return { ...base, kind: 'webhook', config: { ...config, headers, hasSecret } };
  }
  if (row.kind === 'sftp') {
    const parsed = sftpConfigSchema.safeParse(row.config);
    // Settings that are not valid show what they have, with the defaults, so the page can still list it and save it again.
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const config = parsed.success
      ? parsed.data
      : {
          host: text(row.config.host),
          port: Number(row.config.port) || 22,
          username: text(row.config.username),
          auth: 'spooldoc-key' as const,
          publicKey: null,
          folder: text(row.config.folder),
          testFolder: null,
          ifExists: 'replace' as const,
          keepCopy: true,
          tempName: true,
          hostKey: null,
        };
    return { ...base, kind: 'sftp', config: sftpConfigView(config, row.secretsEnc) };
  }
  return { ...base, kind: 'spooldoc', config: {} };
}
