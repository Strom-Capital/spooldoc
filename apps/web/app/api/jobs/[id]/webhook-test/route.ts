import { redact } from '@spooldoc/ibmi';
import { guard } from '@/lib/server/auth';
import { postWebhook } from '@/lib/server/destinations/webhook';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { RESPONSE_LIMIT } from '@/lib/server/runs';
import { draftCall, webhookCallSchema } from '@/lib/server/webhook-call';
import type { WebhookTestView } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Send one page group of the preview spooled file to the URL in use, rendered from the
 * draft and marked `document.test`: one try, no retries, and nothing recorded in the Job
 * log. The answer holds the receiver's status and the start of its answer; 502 with
 * `error` when the call failed.
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
  const call = await draftCall(job, body.data, 'test');
  if ('response' in call) {
    return call.response;
  }
  const result = await postWebhook(call.target, { id: call.id, body: call.body, maxAttempts: 1, later: 'Send the test again later.' });
  const clean = (text: string) => redact(text, call.secrets);
  const answer = result.response ?? '';
  const view: WebhookTestView = {
    status: result.status,
    statusText: result.statusText,
    ms: result.ms,
    body: clean(answer.slice(0, RESPONSE_LIMIT)),
    truncated: answer.length > RESPONSE_LIMIT,
    ...(result.error ? { error: clean(result.error.message), ...(result.error.detail ? { detail: clean(result.error.detail) } : {}) } : {}),
  };
  return json(view, { status: result.ok ? 200 : 502 });
}
