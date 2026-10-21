#!/usr/bin/env node
// A stand-in for the Microsoft 365 token endpoint and Microsoft Graph sendMail, to check
// the Microsoft 365 sender without a tenant. Nothing goes to Microsoft and no email is
// sent: each sendMail request is printed and answered with 202.
//
//   node apps/web/scripts/microsoft-stand-in.mjs 3405
//   SPOOLDOC_MICROSOFT_URL=http://localhost:3405 pnpm --filter @spooldoc/web dev
//
// Some values fail on purpose, to see each error in Settings:
//   tenant ID 00000000-0000-0000-0000-000000000000      no such tenant (AADSTS90002)
//   client ID 00000000-0000-0000-0000-000000000000      no such app (AADSTS700016)
//   client secret "wrong" or "expired"                  a wrong or expired secret
//   client secret "no-consent"                          a token without Mail.Send
//   From address blocked@...                            outside the application access policy
//   From address nobody@...                             no such mailbox
//   From address throttled@...                          429 with Retry-After 120
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3405);
const NONE = '00000000-0000-0000-0000-000000000000';

/** A token shaped like Microsoft's: a JWT with the app's permissions in `roles`. */
const token = (roles) => [{ alg: 'none' }, { aud: 'https://graph.microsoft.com', roles }].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.stand-in';

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const signInError = (res, status, error, code, text) => send(res, status, { error, error_codes: [code], error_description: `AADSTS${code}: ${text}\r\nTrace ID: stand-in` });
const graphError = (res, status, code, message, headers) => send(res, status, { error: { code, message } }, headers);

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const tokenPath = /^\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(url.pathname);
    if (req.method === 'POST' && tokenPath) {
      const form = new URLSearchParams(raw);
      const tenant = decodeURIComponent(tokenPath[1]);
      console.log(`token for tenant ${tenant}, client ${form.get('client_id')}`);
      if (tenant === NONE) return signInError(res, 400, 'invalid_request', 90002, `Tenant '${tenant}' not found.`);
      if (form.get('client_id') === NONE) return signInError(res, 400, 'unauthorized_client', 700016, `Application with identifier '${NONE}' was not found in the directory.`);
      if (form.get('client_secret') === 'wrong') return signInError(res, 401, 'invalid_client', 7000215, 'Invalid client secret provided.');
      if (form.get('client_secret') === 'expired') return signInError(res, 401, 'invalid_client', 7000222, 'The provided client secret keys are expired.');
      const roles = form.get('client_secret') === 'no-consent' ? [] : ['Mail.Send'];
      return send(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: token(roles) });
    }
    const sendPath = /^\/v1\.0\/users\/([^/]+)\/sendMail$/.exec(url.pathname);
    if (req.method === 'POST' && sendPath) {
      const mailbox = decodeURIComponent(sendPath[1]);
      const roles = JSON.parse(Buffer.from((req.headers.authorization ?? '').split('.')[1] ?? '', 'base64url').toString() || '{}').roles ?? [];
      if (!roles.includes('Mail.Send')) return graphError(res, 403, 'ErrorAccessDenied', 'Access is denied. Check credentials and try again.');
      if (mailbox.startsWith('blocked@')) return graphError(res, 403, 'ErrorAccessDenied', 'Access to OData is disabled: [RAOP] : Blocked by tenant configured AppOnly AccessPolicy settings.');
      if (mailbox.startsWith('nobody@')) return graphError(res, 404, 'ErrorInvalidUser', `The requested user '${mailbox}' is invalid.`);
      if (mailbox.startsWith('throttled@')) return graphError(res, 429, 'ApplicationThrottled', 'Application is over its MailboxConcurrency limit.', { 'Retry-After': '120' });
      const { message } = JSON.parse(raw);
      const to = (message.toRecipients ?? []).map((r) => r.emailAddress.address).join(', ');
      const files = (message.attachments ?? []).map((a) => `${a.name}${a.isInline ? ' (inline)' : ''}`).join(', ');
      console.log(`sendMail as ${mailbox} to ${to}: ${message.subject}${files ? ` [${files}]` : ''}`);
      return send(res, 202);
    }
    send(res, 404, { error: { code: 'NotFound', message: `The stand-in has no ${req.method} ${url.pathname}.` } });
  });
}).listen(port, () => console.log(`Microsoft stand-in on http://localhost:${port}`));
