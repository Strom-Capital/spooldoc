import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { draftCall, printedBody, webhookCallSchema } from '@/lib/server/webhook-call';
import { webhookHeaders } from '@/lib/server/webhook-payload';
import type { WebhookPreviewView } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** How a custom header value is printed. */
const MASK = '••••••';

/**
 * The webhook call of one page group of the preview spooled file, as a run would make it
 * (`document.created`, or `document.test` in test mode): the URL in use, the headers with the custom values masked, the real signature, and
 * the body with each file's base64 replaced by its size. Nothing is sent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, webhookCallSchema);
  if ('response' in body) {
    return body.response;
  }
  const call = await draftCall(job, body.data, 'preview');
  if ('response' in call) {
    return call.response;
  }
  const { target } = call;
  const custom = new Set(target.headers.map((header) => header.name));
  const headers = webhookHeaders({
    url: target.url,
    id: call.id,
    timestamp: Math.floor(Date.now() / 1000),
    body: call.body,
    secret: target.secret,
    headers: target.headers,
    toTestUrl: target.toTestUrl,
  });
  const view: WebhookPreviewView = {
    pageGroup: call.pageGroup,
    pageGroups: call.pageGroups,
    document: call.document,
    method: 'POST',
    url: target.url,
    testMode: target.toTestUrl,
    headers: headers.map((header) => (custom.has(header.name) ? { name: header.name, value: MASK } : header)),
    body: printedBody(call.payload),
    bodyBytes: Buffer.byteLength(call.body),
  };
  return json(view);
}
