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

/** How email destinations send: through an SMTP server, or through Microsoft 365 with Microsoft Graph. */
export const MAIL_SENDERS = ['smtp', 'm365'] as const;
export type MailSenderKind = (typeof MAIL_SENDERS)[number];

/** The words for each choice in Settings. */
export const MAIL_SENDER_LABEL: Record<MailSenderKind, string> = { smtp: 'SMTP server', m365: 'Microsoft 365' };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** True for a directory (tenant) ID: a GUID, or a domain of the tenant such as contoso.onmicrosoft.com. */
export const isTenantId = (value: string): boolean => GUID.test(value) || DOMAIN.test(value);

/** True for an application (client) ID: a GUID. */
export const isClientId = (value: string): boolean => GUID.test(value);

const FROM_MESSAGE = 'Enter the From address, such as invoices@example.com';

/**
 * The mail server as the settings form sends it. `sender` picks how email is sent; only
 * that sender's fields are saved, so the other one's stay for when it is picked again. A
 * missing or empty password or client secret keeps the saved one; null removes it.
 */
export const mailSettingsSchema = z
  .object({
    sender: z.enum(MAIL_SENDERS, 'Choose SMTP server or Microsoft 365').default('smtp'),
    host: z.string().trim().max(253, 'Use a host of at most 253 characters').default(''),
    port: z.number('Enter the port').int('Enter a whole port number').min(1, 'Enter a port from 1 to 65535').max(65535, 'Enter a port from 1 to 65535').nullable().default(null),
    security: z.enum(SMTP_SECURITY, 'Choose STARTTLS, TLS or None').default('starttls'),
    user: z.string().trim().max(320, 'Use a user name of at most 320 characters').default(''),
    password: z.string().max(500, 'The password is too long').nullable().optional(),
    tenantId: z.string().trim().max(253, 'Use a tenant ID of at most 253 characters').default(''),
    clientId: z.string().trim().max(36, 'Enter the application (client) ID, a GUID such as 00000000-0000-0000-0000-000000000000').default(''),
    clientSecret: z.string().trim().max(500, 'The client secret is too long').nullable().optional(),
    from: z
      .string()
      .trim()
      .max(320, 'Use an address of at most 320 characters')
      .refine((value) => value === '' || isEmailAddress(value), FROM_MESSAGE),
    fromName: z.string().trim().max(200, 'Use a name of at most 200 characters'),
  })
  .refine((mail) => mail.sender !== 'smtp' || mail.host === '' || !/[\s/:]/.test(mail.host), { message: 'Enter the host name alone, such as smtp.example.com', path: ['host'] })
  .refine((mail) => mail.sender !== 'smtp' || mail.host === '' || mail.from !== '', { message: FROM_MESSAGE, path: ['from'] })
  .refine((mail) => mail.sender !== 'm365' || mail.tenantId === '' || isTenantId(mail.tenantId), {
    message: 'Enter the directory (tenant) ID, a GUID or a domain such as contoso.onmicrosoft.com',
    path: ['tenantId'],
  })
  .refine((mail) => mail.sender !== 'm365' || mail.tenantId === '' || isClientId(mail.clientId), {
    message: 'Enter the application (client) ID, a GUID such as 00000000-0000-0000-0000-000000000000',
    path: ['clientId'],
  })
  .refine((mail) => mail.sender !== 'm365' || mail.tenantId === '' || mail.from !== '', {
    message: 'Enter the mailbox Spooldoc sends from, such as invoices@example.com',
    path: ['from'],
  });
/** The mail server as the form or a test sends it, before the defaults. */
export type MailSettingsInput = z.input<typeof mailSettingsSchema>;
