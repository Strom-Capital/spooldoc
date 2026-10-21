import { z } from 'zod';
import { isEmailAddress } from './destination-config';

/**
 * How Spooldoc talks to the mail server: `tls` from the first byte (usually port 465),
 * `starttls` after the greeting (usually 587), or `none`, for a relay on the local network.
 */
export const SMTP_SECURITY = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** The words for each choice in Settings. */
export const SMTP_SECURITY_LABEL: Record<SmtpSecurity, string> = {
  starttls: 'STARTTLS',
  tls: 'TLS',
  none: 'None',
};

/** The usual port of each choice. */
export const SMTP_DEFAULT_PORT: Record<SmtpSecurity, number> = { starttls: 587, tls: 465, none: 25 };

/** The mail server as the settings form sends it. A missing or empty password keeps the saved one; null removes it. */
export const mailSettingsSchema = z
  .object({
    host: z.string().trim().max(253, 'Use a host of at most 253 characters'),
    port: z.number('Enter the port').int('Enter a whole port number').min(1, 'Enter a port from 1 to 65535').max(65535, 'Enter a port from 1 to 65535').nullable(),
    security: z.enum(SMTP_SECURITY, 'Choose STARTTLS, TLS or None'),
    user: z.string().trim().max(320, 'Use a user name of at most 320 characters'),
    password: z.string().max(500, 'The password is too long').nullable().optional(),
    from: z
      .string()
      .trim()
      .max(320, 'Use an address of at most 320 characters')
      .refine((value) => value === '' || isEmailAddress(value), 'Enter the From address, such as invoices@example.com'),
    fromName: z.string().trim().max(200, 'Use a name of at most 200 characters'),
  })
  .refine((mail) => mail.host === '' || !/[\s/:]/.test(mail.host), { message: 'Enter the host name alone, such as smtp.example.com', path: ['host'] })
  .refine((mail) => mail.host === '' || mail.from !== '', { message: 'Enter the From address, such as invoices@example.com', path: ['from'] });
export type MailSettingsInput = z.infer<typeof mailSettingsSchema>;
