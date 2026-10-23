// Email address lists, read the same way in the browser and on the server: the To, Cc,
// Bcc and Reply-To of an email destination, and the addresses alerts go to.

import addressparser from 'nodemailer/lib/addressparser';
import { isEmailAddress } from './destination-config';

/** An address as a header writes it, with its name if it has one: `john@example.com`, `John Smith <john@example.com>`, `"Smith, John" <john@example.com>`. */
function mailboxText(name: string, address: string): string {
  if (!name) return address;
  return /^[\w !#$%&'*+\-/=?^`{|}~]+$/.test(name) ? `${name} <${address}>` : `"${name.replace(/["\\]/g, '\\$&')}" <${address}>`;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The addresses of a list, read by Nodemailer's address parser, and the text that is not an
 * address. Commas and semicolons both separate addresses, and a quoted name keeps its own,
 * so `"Smith, John" <john@example.com>; jane@example.com` is two. `addresses` has each
 * mailbox as a header writes it, with its name quoted when it needs to be.
 */
export function parseAddresses(text: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  for (const entry of addressparser(text, { flatten: true })) {
    const address = entry.address.trim();
    const name = entry.name.trim();
    // A name goes with the address in angle brackets, or in parentheses after it: `a@example.com b@example.com` is not an address.
    const named = !name || new RegExp(`<\\s*${escapeRegExp(address)}\\s*>`).test(text) || text.includes(`(${name})`);
    if (address && isEmailAddress(address) && named) addresses.push(mailboxText(name, address));
    else if (address || name) invalid.push(!address || !name ? address || name : named ? `${name} <${address}>` : `${address} ${name}`);
  }
  return { addresses, invalid };
}
