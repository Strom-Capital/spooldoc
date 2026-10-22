import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sftpConfigSchema, sftpSecretsInput } from '@/lib/destination-config';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations } from '@/lib/server/db/schema';
import { openSftpSecrets, resolveSftp, type SftpSecrets } from '@/lib/server/destinations/sftp';
import { errorResponse, invalidResponse, json, readJson } from '@/lib/server/http';
import { UUID } from '@/lib/server/servers';
import { checkSftp } from '@/lib/server/sftp-check';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** The destination being edited, for its saved secrets and host key. */
  destinationId: z.string().regex(UUID).nullable().optional(),
  config: z.record(z.string(), z.unknown()),
  secrets: sftpSecretsInput.optional(),
  sealedKey: z.string().max(20_000).optional(),
  /** The token of a host key a check showed, to trust it for this check. */
  trust: z.string().max(10_000).nullable().optional(),
});

/**
 * Check an SFTP destination as the dialog has it, saved or not: reach the host, verify its
 * host key, sign in, and find the folder and the test folder, each as a line. It stops at
 * a host key Spooldoc does not trust, before the sign-in, and answers the key with a token
 * to trust it. It writes nothing on the server and saves nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, schema);
  if ('response' in body) {
    return body.response;
  }
  const { destinationId, config, secrets, sealedKey, trust } = body.data;
  let saved: { config: ReturnType<typeof sftpConfigSchema.parse> | null; secrets: SftpSecrets | null } = { config: null, secrets: null };
  if (destinationId) {
    const [row] = await getDb().select().from(destinations).where(eq(destinations.id, destinationId));
    if (!row || row.kind !== 'sftp') return errorResponse(404, 'Destination not found.');
    const parsed = sftpConfigSchema.safeParse(row.config);
    let savedSecrets: SftpSecrets | null = null;
    try {
      savedSecrets = openSftpSecrets(row.secretsEnc);
    } catch {
      // Secrets sealed with another key: the check needs them again.
    }
    saved = { config: parsed.success ? parsed.data : null, secrets: savedSecrets };
  }
  const resolved = resolveSftp({ config, secrets, sealedKey, hostKeyToken: trust ?? null }, saved, 'check');
  if ('error' in resolved) return invalidResponse(resolved.error, resolved.field.split('.'));
  return json(await checkSftp(resolved.config, resolved.secrets));
}
