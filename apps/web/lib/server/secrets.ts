import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getConfig } from './config';

const VERSION = 'v1';

/**
 * Encrypt a secret (an IBM i password or a model key) with AES-256-GCM and SPOOLDOC_SECRET_KEY.
 *
 * @param plain - The secret
 * @returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getConfig().secretKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/**
 * Decrypt a value from `encryptSecret`.
 *
 * @param what - What the secret is, for the error messages
 *
 * @throws Error when the value was encrypted with another key or was changed
 */
export function decryptSecret(sealed: string, what = 'password'): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error(`The stored ${what} is not in a known format.`);
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', getConfig().secretKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`The stored ${what} cannot be decrypted. Was SPOOLDOC_SECRET_KEY changed? Enter the ${what} again.`);
  }
}
