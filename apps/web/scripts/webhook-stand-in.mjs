#!/usr/bin/env node
// A stand-in receiver for the webhook destination, to check it without a real receiver.
// It checks the Standard Webhooks signature of each call, prints its headers and a short
// summary of the body, and answers 200 with {"received":true}. Nothing is stored.
//
//   WEBHOOK_SECRET=whsec_... node apps/web/scripts/webhook-stand-in.mjs 3406
//   node apps/web/scripts/webhook-stand-in.mjs 3406 whsec_...
//
// Then add a webhook destination with the URL http://localhost:3406/spooldoc and give the
// stand-in the signing secret Spooldoc shows. Without a secret, signatures are not checked.
//
// Some URLs answer otherwise on purpose, to see each error in the Job log:
//   ?fail=N        503 for the first N calls of each document, then 200 (Retry and the tries)
//   ?status=401    that status for every call, such as 401, 404, 413 or 400
//   ?redirect=1    301 to another URL, which Spooldoc does not follow
//   ?slow=1        no answer for 35 seconds, past Spooldoc's 30 second wait
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3406);
const secret = process.argv[3] ?? process.env.WEBHOOK_SECRET ?? '';
/** Calls so far for each webhook-id, for `?fail=N`. */
const tries = new Map();

/** True when one of the signatures in the header matches the body. */
function signed(headers, body) {
  const id = headers['webhook-id'] ?? '';
  const timestamp = headers['webhook-timestamp'] ?? '';
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'));
  return String(headers['webhook-signature'] ?? '')
    .split(' ')
    .map((part) => Buffer.from(part.replace(/^v1,/, '')))
    .some((given) => given.length === expected.length && timingSafeEqual(given, expected));
}

/** A line about the call: its type, the document and its files, without the base64. */
function summary(body) {
  try {
    const { type, data } = JSON.parse(body);
    const files = (data.files ?? []).map((file) => `${file.name} (${file.size} bytes)`).join(', ') || 'no files';
    return `${type} ${data.document?.name} (page group ${data.document?.pageGroup ?? 'all'} of ${data.document?.pageGroups}), job ${data.job?.name}, ${files}`;
  } catch {
    return `${body.length} bytes that are not JSON`;
  }
}

const answer = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const id = req.headers['webhook-id'] ?? '';
    console.log(`\n${req.method} ${url.pathname}${url.search}`);
    for (const [name, value] of Object.entries(req.headers)) console.log(`  ${name}: ${name === 'authorization' ? '(set)' : value}`);
    console.log(`  ${summary(raw)}`);
    if (secret) {
      const ok = signed(req.headers, raw);
      console.log(`  signature ${ok ? 'checks out' : 'DOES NOT MATCH'}`);
      if (!ok) return answer(res, 401, { error: 'The signature does not match.' });
    }
    const n = (tries.get(id) ?? 0) + 1;
    tries.set(id, n);
    const fail = Number(url.searchParams.get('fail') ?? 0);
    if (n <= fail) return answer(res, 503, { error: `Failing on purpose, call ${n} of ${fail}.` });
    const status = Number(url.searchParams.get('status') ?? 0);
    if (status) return answer(res, status, { error: `Answering ${status} on purpose.` });
    if (url.searchParams.has('redirect')) return answer(res, 301, undefined, { Location: `http://localhost:${port}/moved` });
    if (url.searchParams.has('slow')) return setTimeout(() => answer(res, 200, { received: true }), 35_000);
    return answer(res, 200, { received: true });
  });
}).listen(port, () => console.log(`Webhook stand-in on http://localhost:${port}${secret ? ', checking signatures' : ', not checking signatures (no secret)'}`));
