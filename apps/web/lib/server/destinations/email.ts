import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { EmailConfig } from '@/lib/destination-config';
import { getDb } from '../db';
import { runDeliveries, runs } from '../db/schema';
import { addressList, composeEmail, formatOf, type EmailFormatting } from '../email-message';
import { getFormats } from '../formats';
import { fromHeader, mailErrorText, mailSecrets, mailSender, mailServer, NO_MAIL_SERVER, stopsSending } from '../mail';
import { StepError } from '../step-error';
import type { DeliverInput, Destination } from './index';
import { storeRunFiles } from './store';

/** "1 email", "3 emails". */
export const nEmails = (n: number): string => `${n} ${n === 1 ? 'email' : 'emails'}`;

type DeliveryRow = typeof runDeliveries.$inferInsert;

/**
 * Sends one email per document through the mail server in Settings: To, Cc, Bcc,
 * Reply-To, Subject and the message from the job's email part, with the document's files
 * in the formats it attaches. The files are kept in Spooldoc first, so the Job log can
 * show what was mailed. A document an earlier run of the same job already sent for the
 * same spooled file is not sent again (a test send does not count), so Retry sends only
 * the rest. Every email is recorded as it goes. When any fails, the step fails after the
 * others are sent, so the finish step does not run.
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

      const db = getDb();
      // Documents sent for real by an earlier run of this job on this spooled file.
      const earlier = await db
        .select({ document: runDeliveries.document, to: runDeliveries.to, seq: runs.seq })
        .from(runDeliveries)
        .innerJoin(runs, eq(runs.id, runDeliveries.runId))
        .where(and(eq(runDeliveries.jobId, job.id), eq(runDeliveries.splfKey, job.splfKey), eq(runDeliveries.status, 'sent'), eq(runDeliveries.test, false)))
        .orderBy(runs.seq);
      // The first run that sent each document, and where it went.
      const sentBefore = new Map<string, { seq: number; to: string }>();
      for (const row of earlier) if (!sentBefore.has(row.document)) sentBefore.set(row.document, { seq: row.seq, to: row.to });
      const sentIn = new Map([...sentBefore].map(([document, { seq }]) => [document, seq]));

      const attached = (index: number | null) =>
        files.filter((file) => {
          const format = formatOf(file.contentType);
          return file.pageGroupIndex === index && format !== undefined && spec.attach.includes(format);
        });
      // An email per page group; the whole spooled file's document only when Attach picks one of its files.
      const emails = documents.filter((document) => document.pageGroupIndex !== null || attached(null).length > 0);
      if (emails.length === 0) {
        throw new StepError('deliver', 'No email to send: Attach picks none of the files the templates make. Change Attach in the Destination step of the job.');
      }

      const test = config.testAddress;
      const record = (row: Omit<DeliveryRow, 'runId' | 'jobId' | 'splfKey' | 'destinationId'>) =>
        db.insert(runDeliveries).values({ runId, jobId: job.id, splfKey: job.splfKey, destinationId: input.destinationId, ...row });

      const sender = mailSender(server);
      let sent = 0;
      let already = 0;
      const failures: { message: string; detail?: string }[] = [];
      let stopped: { message: string; detail?: string } | null = null;
      try {
        for (const document of emails) {
          const base = { pageGroupIndex: document.pageGroupIndex, document: document.name };
          const before = sentBefore.get(document.name);
          if (before !== undefined) {
            already++;
            await record({ ...base, to: before.to, status: 'already_sent', sentInRun: before.seq });
            continue;
          }
          if (stopped) {
            const message = `Not sent: ${stopped.message}`;
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
      if (failures.length > 0) {
        const first = failures[0]!;
        const more = failures.length > 1 ? ` ${failures.length - 1} more failed; the Emails list of the run has each one.` : '';
        throw new StepError('deliver', `Sent ${sent + already} of ${nEmails(total)}. ${first.message}${more}`, first.detail);
      }
      const runsBefore = [...new Set(emails.map((document) => sentIn.get(document.name)).filter((seq) => seq !== undefined))];
      const earlierText =
        already > 0 ? `, ${already} ${already === 1 ? 'was' : 'were'} sent in ${runsBefore.length === 1 ? `run #${runsBefore[0]}` : 'earlier runs'}` : '';
      if (test) return `Sent ${nEmails(sent)} to the test address ${test}${earlierText}`;
      return `Sent ${nEmails(sent)}${earlierText}`;
    },
  };
}
