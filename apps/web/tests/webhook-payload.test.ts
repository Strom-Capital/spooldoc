import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';
import { newSigningSecret, webhookId, webhookPayload, webhookSignature, type WebhookContext } from '@/lib/server/webhook-payload';
import { loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const context: WebhookContext = {
  job: { id: 'job-1', name: 'MYJOB', version: 3 },
  run: { id: 'run-1', seq: 128 },
  splf: { ...sample.splf, name: 'QPRINT', number: 4, jobName: 'MYJOB', jobUser: 'MYUSER', jobNumber: '123456' },
  attributes: { ...sample.attributes, queue: { library: 'MYLIB', name: 'MYOUTQ' }, userData: 'INV', pages: 6 },
};
const pdf = { pageGroupIndex: 0, template: 'Invoice', templateIndex: 0, name: 'invoice-260101.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) };
const at = new Date('2026-10-21T09:14:03.512Z');

describe('the webhook payload', () => {
  it('holds the document of a page group, the job, the run, the spooled file, its data and files', () => {
    const data = { pg: { invoiceNo: '260101' }, splf: context.splf };
    expect(webhookPayload({ type: 'document.created', at, document: { pageGroupIndex: 0, name: 'invoice-260101', data }, pageGroups: 6, context, files: [pdf] })).toEqual({
      type: 'document.created',
      timestamp: '2026-10-21T09:14:03Z',
      data: {
        document: { name: 'invoice-260101', pageGroup: 1, pageGroups: 6 },
        job: { id: 'job-1', name: 'MYJOB', version: 3 },
        run: { id: 'run-1', number: 128 },
        spooledFile: { name: 'QPRINT', number: 4, jobName: 'MYJOB', jobUser: 'MYUSER', jobNumber: '123456', outputQueue: 'MYLIB/MYOUTQ', userData: 'INV', pages: 6 },
        data,
        files: [{ name: 'invoice-260101.pdf', contentType: 'application/pdf', size: 4, template: 'Invoice', content: 'JVBERg==' }],
      },
    });
  });

  it('holds every page group for the document of the whole spooled file, with no page group number', () => {
    const data = { pgs: [{ invoiceNo: '260101' }, { invoiceNo: '260102' }], splf: context.splf };
    const payload = webhookPayload({ type: 'document.test', at, document: { pageGroupIndex: null, name: 'qprint', data }, pageGroups: 2, context: { ...context, run: null }, files: [] });
    expect(payload.type).toBe('document.test');
    expect(payload.data.document).toEqual({ name: 'qprint', pageGroup: null, pageGroups: 2 });
    expect(payload.data.data).toEqual(data);
    expect(payload.data.run).toBeNull();
    expect(payload.data.files).toEqual([]);
  });
});

describe('signing', () => {
  it('signs as Standard Webhooks does', () => {
    const secret = newSigningSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const body = '{"type":"document.created"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = webhookSignature(secret, 'msg_1', timestamp, body);
    expect(signature).toBe(new Webhook(secret).sign('msg_1', new Date(timestamp * 1000), body));
    expect(() => new Webhook(secret).verify(body, { 'webhook-id': 'msg_1', 'webhook-timestamp': String(timestamp), 'webhook-signature': signature })).not.toThrow();
  });

  it('gives a document the same id every time, and a test call another one', () => {
    const input = { jobId: 'job-1', splfKey: 'QPRINT/4/123456/MYUSER/MYJOB', document: 'invoice-260101', test: false };
    expect(webhookId(input)).toBe(webhookId(input));
    expect(webhookId(input)).not.toBe(webhookId({ ...input, document: 'invoice-260102' }));
    expect(webhookId(input)).not.toBe(webhookId({ ...input, test: true }));
  });
});
