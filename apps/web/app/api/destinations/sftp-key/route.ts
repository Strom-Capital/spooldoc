import { z } from 'zod';
import { SFTP_KEY_TYPES } from '@/lib/destination-config';
import { guard } from '@/lib/server/auth';
import { json, readJson } from '@/lib/server/http';
import { makeKeyPair, sealKey } from '@/lib/server/sftp';
import type { SftpKeyView } from '@/lib/types';

export const dynamic = 'force-dynamic';

const schema = z.object({
  type: z.enum(SFTP_KEY_TYPES).default('ed25519'),
  /** The destination's name, for the key's comment. */
  name: z.string().max(80).default(''),
});

/**
 * Make a key pair for an SFTP destination: the public line to add to the server, and the
 * private key sealed with SPOOLDOC_SECRET_KEY. The page holds only the sealed key and
 * hands it back on check and save, so the private key never reaches the browser, and the
 * key can be added to the server and checked before the destination is saved.
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
  const pair = makeKeyPair(body.data.type, body.data.name.trim() || 'destination');
  const view: SftpKeyView = { publicKey: pair.publicKey, key: pair.key, sealed: sealKey(pair.privateKey) };
  return json(view);
}
