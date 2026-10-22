import 'server-only';

import type { EmailConfig } from '@/lib/destination-config';
import { addressList, composeEmail, formatOf, type EmailFormatting } from '../email-message';
import { getFormats } from '../formats';
import { fromHeader, mailErrorText, mailSecrets, mailSender, mailServer, NO_MAIL_SERVER, stopsSending } from '../mail';
import { StepError } from '../step-error';
import { deliveryFailed, deliveryLock, deliveryRecorder, documentFields, earlierDeliveries, earlierText, notSent, sentBefore, setDeliveryLockWait } from './deliveries';
import type { DeliverInput, Destination } from './index';
import { storeRunFiles } from './store';

/** "1 email", "3 emails". */
export const nEmails = (n: number): string => `${n} ${n === 1 ? 'email' : 'emails'}`;

/** Change how long the email lock is waited for, for tests. Null puts back the defaults. */
export const setEmailLockWait = setDeliveryLockWait;

/**
 * Sends one email per document through the mail server in Settings: To, Cc, Bcc,
 * Reply-To, Subject and the message from the job's email part, with the document's files
 * in the formats it attaches. The files are kept in Spooldoc first, so the Job log can
 * show what was mailed. A document an earlier run of the same job already sent for the
 * same spooled file, created at the same time, with the same pages and name, is not sent
 * again (a test send does not count), so Retry sends only the rest. With a test address,
 * every document goes to it, whatever earlier runs sent. One run at a time sends email
 * for a job and spooled file; a second waits for the first. Every email is recorded as it
 * goes. When any fails, the step fails after the others are sent, so the finish step does
 * not run.
 */
export function emailDestination(config: EmailConfig): Destination {
  return {
    kind: 'email',
    async deliver(input: DeliverInput) {
      const { runId, files, documents, job } = input;
      const spec = input.email;
      if (!spec || !spec.to.trim()) {
        throw new StepError('deliver', 'The job sets no To address. Open the Destination step of the job and fill in To.');
      }
      const server = await mailServer().catch((error: unknown) => {
        throw new StepError('deliver', error instanceof Error ? error.message : String(error));
      });
      if (!server) throw new StepError('deliver', NO_MAIL_SERVER);
      for (const secret of mailSecrets(server)) input.addSecret(secret);

      await storeRunFiles(runId, files);
      const formatting: EmailFormatting = { formats: await getFormats(), types: input.valueTypes };

      const release = await deliveryLock('email', job, 'Another run of this job is sending email for this spooled file. Retry when it has finished.');
      try {
        const test = config.testAddress;
        // The spooled file's creation time, as the run read it; "" when the IBM i did not give it.
        const created = input.context.attributes.created;
        // Documents sent for real by an earlier run of this job on this spooled file, first run first; none with a test address.
        const earlier = await earlierDeliveries('email', job, test !== null);

        const attached = (index: number | null) =>
          files.filter((file) => {
            const format = formatOf(file.contentType);
            return file.pageGroupIndex === index && format !== undefined && spec.attach.includes(format);
          });
        // The whole spooled file's document gets an email when Attach picks one of its files. A page group
        // gets one when Attach picks one of its files, or no file of the whole spooled file either, so an
        // email that is the document goes to each page group.
        const whole = attached(null).length > 0;
        const emails = documents.filter((document) => (document.pageGroupIndex === null ? whole : !whole || attached(document.pageGroupIndex).length > 0));
        if (emails.length === 0) {
          throw new StepError('deliver', 'No email to send: Attach picks none of the files the templates make. Change Attach in the Destination step of the job.');
        }

        const record = deliveryRecorder(input, 'email');

        const sender = mailSender(server);
        let sent = 0;
        let already = 0;
        const runsBefore = new Set<number>();
        const failures: { message: string; detail?: string }[] = [];
        let stopped: { message: string; detail?: string } | null = null;
        try {
          for (const document of emails) {
            const base = documentFields(document, created);
            const before = sentBefore(earlier, document, created);
            if (before !== undefined) {
              already++;
              runsBefore.add(before.seq);
              await record({ ...base, to: before.to, status: 'already_sent', sentInRun: before.seq });
              continue;
            }
            if (stopped) {
              const message = notSent(stopped.message);
              failures.push({ message: `${document.name}: ${message}` });
              await record({ ...base, status: 'failed', error: message, detail: stopped.detail ?? null });
              continue;
            }
            const composed = composeEmail({
              spec,
              data: document.data,
              document: document.name,
              files: files.filter((file) => file.pageGroupIndex === document.pageGroupIndex),
              from: fromHeader(server),
              testAddress: test,
              templateHtml: document.html ?? null,
              formatting,
            });
            if (!composed.email) {
              const message = `${composed.problems.join('. ')}.`;
              failures.push({ message: `${document.name}: ${message}` });
              await record({ ...base, to: addressList(spec.to, document.data, formatting).addresses.join(', '), status: 'failed', error: message });
              continue;
            }
            const to = composed.email.to.join(', ');
            try {
              const info = await sender.sendMail(composed.email.message);
              sent++;
              await record({ ...base, to, test: test !== null, status: 'sent', messageId: info.messageId ?? null });
            } catch (error) {
              const { message, detail } = mailErrorText(error, server);
              failures.push({ message: `${document.name}: ${message}`, detail });
              await record({ ...base, to, test: test !== null, status: 'failed', error: message, detail: detail ?? null });
              if (stopsSending(error)) stopped = { message, detail };
            }
          }
        } finally {
          sender.close?.();
        }

        const total = emails.length;
        if (failures.length > 0) throw deliveryFailed(`Sent ${sent + already} of ${nEmails(total)}`, failures, 'Emails');
        const before = earlierText(already, runsBefore, 'sent');
        if (test) return `Sent ${nEmails(sent)} to the test address ${test}${before}`;
        return `Sent ${nEmails(sent)}${before}`;
      } finally {
        await release();
      }
    },
  };
}
