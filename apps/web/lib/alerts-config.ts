// The Alerts section of Settings: the addresses alerts go to. Read the same way in the
// browser, as you type, and on the server, when the settings are saved.

import { z } from 'zod';
import { parseAddresses } from './addresses';

/** Why the addresses cannot be saved, naming the first that is not an address. Null when they can. */
export function alertAddressProblem(text: string): string | null {
  const { invalid } = parseAddresses(text);
  return invalid.length > 0 ? `Could not read "${invalid[0]}" as an email address. Separate addresses with commas, such as ops@example.com, it@example.com.` : null;
}

/** The `alerts` part of a settings change. Empty turns alerts off; the addresses are saved as one list, comma separated. */
export const alertsSchema = z.object({
  to: z
    .string()
    .trim()
    .max(2000, 'Use at most 2000 characters of addresses')
    .superRefine((value, ctx) => {
      const problem = alertAddressProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .transform((value) => parseAddresses(value).addresses.join(', ')),
});
export type AlertsInput = z.input<typeof alertsSchema>;
