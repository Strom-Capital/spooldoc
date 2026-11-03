import { ConnectionError } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IfExists } from '@/lib/destination-config';
import { emptySpec } from '@/lib/job-spec';
import { destinations, jobs, runDeliveries, runs } from '@/lib/server/db/schema';
import { ifsDestination } from '@/lib/server/destinations/ifs';
import type { RunFile } from '@/lib/server/destinations/store';
import { resetTables } from './helpers/db';
import { FakeConnection, loadSample } from './helpers/fake-connection';
import { builtinDestination, db, insertServer } from './helpers/fixtures';

const FOLDER = '/home/docs/out';
const HOST = 'ibmi.example.com';
const OLD = new Uint8Array([1]);
const sample = loadSample('invoice');

const file = (name: string, byte = 9, pageGroupIndex = 0): RunFile => ({
  pageGroupIndex,
  template: 'Invoice',
  templateIndex: 0,
  name,
  contentType: 'application/pdf',
  content: new Uint8Array([byte]),
});

let serverId: string;

beforeEach(async () => {
  await resetTables(db());
  serverId = await insertServer();
});

/** A job and an IFS destination, new for each call, so earlier writes of another setup never count. */
async function setup(ifExists: IfExists, existing: string[] = [], conn = new FakeConnection()) {
  conn.folders.add(FOLDER);
  for (const name of existing) conn.ifs.set(`${FOLDER}/${name}`, { bytes: OLD, ccsid: 65535 });
  const [job] = await db()
    .insert(jobs)
    .values({ name: 'MYJOB', draft: emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: await builtinDestination() }) })
    .returning();
  const jobId = job!.id;
  const destination = async (folder = FOLDER) => (await db().insert(destinations).values({ kind: 'ifs', name: 'MYIFS', config: { folder, ifExists, keepCopy: false } }).returning())[0]!.id;
  const destinationId = await destination();
  /** Delivers through a destination, as one new run, which `lastRun` then names. */
  let lastRun = '';
  const deliverTo = async (files: RunFile[], to: { destinationId: string; folder: string }) => {
    const [run] = await db().insert(runs).values({ jobId, version: 1, trigger: 'manual', splf: sample.splf }).returning();
    lastRun = run!.id;
    return ifsDestination({ folder: to.folder, ifExists, keepCopy: false }).deliver({
      runId: run!.id,
      files,
      documents: [],
      keepFiles: async () => undefined,
      job: { id: jobId, splfKey: 'key' },
      destinationId: to.destinationId,
      route: null,
      templates: [],
      email: null,
      webhook: null,
      context: { job: { id: jobId, name: 'MYJOB', version: 1 }, run: { id: run!.id, seq: run!.seq }, splf: sample.splf, attributes: sample.attributes, pageGroups: 1 },
      valueTypes: {},
      conn,
      host: HOST,
      addSecret: () => undefined,
    });
  };
  const deliver = (files: RunFile[]) => deliverTo(files, { destinationId, folder: FOLDER });
  const names = () => [...conn.ifs.keys()].map((path) => path.slice(FOLDER.length + 1)).sort();
  const writes = () => conn.calls.filter((call) => call.method === 'writeIfsFile').map((call) => call.args);
  const rows = async (runId = lastRun) => db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId)).orderBy(runDeliveries.sentAt);
  const seqOf = async (runId: string) => (await db().select({ seq: runs.seq }).from(runs).where(eq(runs.id, runId)))[0]!.seq;
  return { conn, deliver, deliverTo, destination, names, writes, rows, seqOf, lastRun: () => lastRun };
}

/** Makes `name` appear in the folder just before the next write, as another run would. */
function appearsBeforeWrite(conn: FakeConnection, name: string) {
  const write = conn.writeIfsFile.bind(conn);
  vi.spyOn(conn, 'writeIfsFile').mockImplementationOnce(async (path, bytes, options) => {
    conn.ifs.set(`${FOLDER}/${name}`, { bytes: OLD, ccsid: 65535 });
    return write(path, bytes, options);
  });
}

describe('the IFS destination', () => {
  it('asks the write to fail, not replace, in Fail the run and Add a number', async () => {
    for (const [mode, ifExists] of [
      ['replace', 'replace'],
      ['fail', 'fail'],
      ['suffix', 'fail'],
    ] as const) {
      const { deliver, writes } = await setup(mode);
      await deliver([file('invoice-1001.pdf')]);
      expect(writes()[0]![1]).toEqual({ ccsid: 65535, ifExists });
    }
  });

  it('gives a number to a name that differs only in case from another of the run, in every mode', async () => {
    for (const mode of ['replace', 'fail', 'suffix'] as const) {
      const { deliver, names, conn } = await setup(mode);
      const note = await deliver([file('Acme.pdf', 1), file('ACME.pdf', 2)]);
      expect(names()).toEqual(['ACME-2.pdf', 'Acme.pdf']);
      expect(conn.ifs.get(`${FOLDER}/Acme.pdf`)?.bytes).toEqual(new Uint8Array([1]));
      expect(conn.ifs.get(`${FOLDER}/ACME-2.pdf`)?.bytes).toEqual(new Uint8Array([2]));
      expect(note).toBe(`Wrote 2 files to ${FOLDER} on ${HOST} (1 with a number added)`);
    }
  });

  it('does not number a case-only name onto another file of the run', async () => {
    const { deliver, names } = await setup('replace');
    await deliver([file('a.pdf'), file('A.pdf'), file('a-2.pdf')]);
    expect(names()).toEqual(['A-3.pdf', 'a-2.pdf', 'a.pdf']);
  });

  it('fails the run before writing when a name is taken in another case', async () => {
    const { deliver, writes } = await setup('fail', ['INVOICE-1001.PDF']);
    await expect(deliver([file('invoice-1001.pdf')])).rejects.toThrow(`invoice-1001.pdf is already in ${FOLDER}. Nothing was written.`);
    expect(writes()).toEqual([]);
  });

  it('adds a number past a name taken in another case', async () => {
    const { deliver, names } = await setup('suffix', ['INVOICE-1001.PDF', 'Invoice-1001-2.pdf']);
    await deliver([file('invoice-1001.pdf')]);
    expect(names()).toEqual(['INVOICE-1001.PDF', 'Invoice-1001-2.pdf', 'invoice-1001-3.pdf']);
  });

  it('in Fail the run, does not replace a file that appears after the check, and says what was written', async () => {
    const { conn, deliver, names } = await setup('fail');
    const write = conn.writeIfsFile.bind(conn);
    let calls = 0;
    vi.spyOn(conn, 'writeIfsFile').mockImplementation(async (path, bytes, options) => {
      if (++calls === 2) conn.ifs.set(`${FOLDER}/invoice-1002.pdf`, { bytes: OLD, ccsid: 65535 });
      return write(path, bytes, options);
    });
    const err = await deliver([file('invoice-1001.pdf'), file('invoice-1002.pdf')]).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `Wrote 1 of 2 files to ${FOLDER} on ${HOST}. invoice-1002.pdf is already in ${FOLDER}: another run or program wrote it after this run looked. It was not replaced. Change "When a file with the same name exists" or move the old file.`,
    );
    expect(conn.ifs.get(`${FOLDER}/invoice-1002.pdf`)?.bytes).toEqual(OLD);
    expect(names()).toEqual(['invoice-1001.pdf', 'invoice-1002.pdf']);
  });

  it('in Add a number, takes the next number when the name is taken after the check', async () => {
    const { conn, deliver, names } = await setup('suffix', ['invoice-1001.pdf']);
    appearsBeforeWrite(conn, 'invoice-1001-2.pdf');
    const note = await deliver([file('invoice-1001.pdf', 7)]);
    expect(names()).toEqual(['invoice-1001-2.pdf', 'invoice-1001-3.pdf', 'invoice-1001.pdf']);
    expect(conn.ifs.get(`${FOLDER}/invoice-1001-3.pdf`)?.bytes).toEqual(new Uint8Array([7]));
    expect(conn.ifs.get(`${FOLDER}/invoice-1001-2.pdf`)?.bytes).toEqual(OLD);
    expect(note).toBe(`Wrote 1 file to ${FOLDER} on ${HOST} (1 with a number added)`);
  });

  it('in Add a number, numbers a name that was free at the check and taken at the write', async () => {
    const { conn, deliver, names } = await setup('suffix');
    appearsBeforeWrite(conn, 'invoice-1001.pdf');
    await deliver([file('invoice-1001.pdf')]);
    expect(names()).toEqual(['invoice-1001-2.pdf', 'invoice-1001.pdf']);
  });

  it('in Replace, replaces a file that appears after the check', async () => {
    const { conn, deliver } = await setup('replace');
    appearsBeforeWrite(conn, 'invoice-1001.pdf');
    const note = await deliver([file('invoice-1001.pdf', 7)]);
    expect(conn.ifs.get(`${FOLDER}/invoice-1001.pdf`)?.bytes).toEqual(new Uint8Array([7]));
    expect(note).toBe(`Wrote 1 file to ${FOLDER} on ${HOST} (1 replaced)`);
  });

  it('says when a replaced file was left over', async () => {
    const { conn, deliver } = await setup('replace', ['invoice-1001.pdf']);
    vi.spyOn(conn, 'writeIfsFile').mockResolvedValueOnce({ replaced: true, leftover: `${FOLDER}/.invoice-1001.pdf.0a0b0c0d.old` });
    const note = await deliver([file('invoice-1001.pdf')]);
    expect(note).toBe(
      `Wrote 1 file to ${FOLDER} on ${HOST} (1 replaced). The replaced file was kept as ${FOLDER}/.invoice-1001.pdf.0a0b0c0d.old, since it could not be deleted. Delete it`,
    );
  });

  it('keeps the error of a write that fails for another reason', async () => {
    const { conn, deliver } = await setup('replace');
    vi.spyOn(conn, 'writeIfsFile').mockRejectedValueOnce(new ConnectionError('other', 'The new file could not be renamed.', { detail: 'CPFA0B1' }));
    await expect(deliver([file('invoice-1001.pdf')])).rejects.toMatchObject({
      message: `Wrote 0 of 1 file to ${FOLDER} on ${HOST}. invoice-1001.pdf: The new file could not be renamed.`,
      detail: 'CPFA0B1',
    });
  });

  it('records each file written, with its path, size and time', async () => {
    const { deliver, rows } = await setup('suffix', ['invoice-1002.pdf']);
    await deliver([file('invoice-1001.pdf', 1), file('invoice-1002.pdf', 2, 1)]);
    expect((await rows()).map((row) => [row.kind, row.status, row.document, row.to, row.messageId, row.size, row.test])).toEqual([
      ['ifs', 'sent', 'invoice-1001.pdf', `${FOLDER}/invoice-1001.pdf`, null, 1, false],
      ['ifs', 'sent', 'invoice-1002.pdf', `${FOLDER}/invoice-1002-2.pdf`, 'invoice-1002-2.pdf', 1, false],
    ]);
    expect((await rows())[0]).toMatchObject({ splfCreated: sample.attributes.created, ms: expect.any(Number) });
  });

  it('fails every file, and writes none, when the folder is gone', async () => {
    const { conn, deliver, rows } = await setup('replace');
    conn.folders.delete(FOLDER);
    await expect(deliver([file('invoice-1001.pdf'), file('invoice-1002.pdf', 9, 1)])).rejects.toThrow(`The folder ${FOLDER} does not exist on ${HOST}.`);
    expect((await rows()).map((row) => [row.status, row.error])).toEqual([
      ['failed', `Not written: The folder ${FOLDER} does not exist on ${HOST}. Create it, or change the destination's folder.`],
      ['failed', `Not written: The folder ${FOLDER} does not exist on ${HOST}. Create it, or change the destination's folder.`],
    ]);
  });

  it('writes the other files when one fails, and says how many failed', async () => {
    const { conn, deliver, rows } = await setup('replace');
    vi.spyOn(conn, 'writeIfsFile').mockRejectedValueOnce(new ConnectionError('authority', 'Not authorized to write in the folder.', { detail: 'CPFA09C' }));
    const err = await deliver([file('invoice-1001.pdf'), file('invoice-1002.pdf', 9, 1), file('invoice-1003.pdf', 9, 2)]).catch((e: unknown) => e);
    expect((err as Error).message).toBe(`Wrote 2 of 3 files to ${FOLDER} on ${HOST}. invoice-1001.pdf: Not authorized to write in the folder.`);
    expect((await rows()).map((row) => row.status)).toEqual(['failed', 'sent', 'sent']);
    expect((await rows())[0]).toMatchObject({ error: 'Not authorized to write in the folder.', detail: 'CPFA09C', to: `${FOLDER}/invoice-1001.pdf` });
  });

  it('stops when the connection is lost, and the files not tried say why', async () => {
    const { conn, deliver, rows } = await setup('replace');
    vi.spyOn(conn, 'writeIfsFile').mockRejectedValueOnce(new ConnectionError('host', 'The connection to ibmi.example.com was lost.'));
    const err = await deliver([file('invoice-1001.pdf'), file('invoice-1002.pdf', 9, 1), file('invoice-1003.pdf', 9, 2)]).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `Wrote 0 of 3 files to ${FOLDER} on ${HOST}. invoice-1001.pdf: The connection to ibmi.example.com was lost. 2 more failed; the Files written list of the run has each one.`,
    );
    expect((await rows()).map((row) => [row.status, row.error])).toEqual([
      ['failed', 'The connection to ibmi.example.com was lost.'],
      ['failed', 'Not written: The connection to ibmi.example.com was lost.'],
      ['failed', 'Not written: The connection to ibmi.example.com was lost.'],
    ]);
  });

  /** The connection is lost after the first file is written. */
  function lostAfterOne(conn: FakeConnection) {
    const write = conn.writeIfsFile.bind(conn);
    vi.spyOn(conn, 'writeIfsFile')
      .mockImplementationOnce(write)
      .mockRejectedValueOnce(new ConnectionError('host', 'The connection to ibmi.example.com was lost.'));
  }

  describe('Retry', () => {
    const invoices = () => [file('invoice-1001.pdf', 1, 0), file('invoice-1002.pdf', 2, 1), file('invoice-1003.pdf', 3, 2)];

    it('in Fail the run, writes only the files not written yet after a run that failed partway', async () => {
      const { conn, deliver, names, rows, seqOf, lastRun } = await setup('fail');
      lostAfterOne(conn);
      await expect(deliver(invoices())).rejects.toThrow(`Wrote 1 of 3 files to ${FOLDER} on ${HOST}.`);
      const first = lastRun();
      expect((await rows(first)).map((row) => row.status)).toEqual(['sent', 'failed', 'failed']);
      expect(names()).toEqual(['invoice-1001.pdf']);

      vi.restoreAllMocks();
      const note = await deliver(invoices());
      expect(note).toBe(`Wrote 2 files to ${FOLDER} on ${HOST}, 1 was written in run #${await seqOf(first)}`);
      expect(names()).toEqual(['invoice-1001.pdf', 'invoice-1002.pdf', 'invoice-1003.pdf']);
      // The file the first run wrote is not in the way: it was not written again.
      expect(conn.ifs.get(`${FOLDER}/invoice-1001.pdf`)?.bytes).toEqual(new Uint8Array([1]));
      expect((await rows()).map((row) => [row.document, row.status, row.sentInRun])).toEqual([
        ['invoice-1001.pdf', 'already_sent', await seqOf(first)],
        ['invoice-1002.pdf', 'sent', null],
        ['invoice-1003.pdf', 'sent', null],
      ]);
    });

    it('in Fail the run, still stops when a file the earlier run did not write is in the way', async () => {
      const { conn, deliver, writes, rows } = await setup('fail');
      await deliver([file('invoice-1001.pdf', 1, 0)]);
      conn.ifs.set(`${FOLDER}/invoice-1002.pdf`, { bytes: OLD, ccsid: 65535 });
      await expect(deliver(invoices())).rejects.toThrow(`invoice-1002.pdf is already in ${FOLDER}. Nothing was written.`);
      expect(writes()).toHaveLength(1);
      expect((await rows()).map((row) => row.status)).toEqual(['already_sent', 'failed', 'failed']);
    });

    it('in Add a number, makes no numbered copies of the files already written', async () => {
      const { conn, deliver, names } = await setup('suffix');
      lostAfterOne(conn);
      await expect(deliver(invoices())).rejects.toThrow();
      vi.restoreAllMocks();
      const note = await deliver(invoices());
      expect(note).toMatch(/^Wrote 2 files to \/home\/docs\/out on ibmi\.example\.com, 1 was written in run #\d+$/);
      expect(names()).toEqual(['invoice-1001.pdf', 'invoice-1002.pdf', 'invoice-1003.pdf']);
    });

    it('writes nothing again when every file was written', async () => {
      const { deliver, writes, rows } = await setup('replace');
      await deliver(invoices());
      const note = await deliver(invoices());
      expect(note).toMatch(/^Wrote 0 files to \/home\/docs\/out on ibmi\.example\.com, 3 were written in run #\d+$/);
      expect(writes()).toHaveLength(3);
      expect((await rows()).map((row) => row.status)).toEqual(['already_sent', 'already_sent', 'already_sent']);
    });

    it('writes again a file written through another IFS destination', async () => {
      const { deliver, deliverTo, destination, names } = await setup('suffix');
      await deliverTo(invoices(), { destinationId: await destination(), folder: FOLDER });
      const note = await deliver(invoices());
      expect(note).toBe(`Wrote 3 files to ${FOLDER} on ${HOST} (3 with a number added)`);
      expect(names()).toEqual(['invoice-1001-2.pdf', 'invoice-1001.pdf', 'invoice-1002-2.pdf', 'invoice-1002.pdf', 'invoice-1003-2.pdf', 'invoice-1003.pdf']);
    });

    it('writes again after the folder of the destination changed', async () => {
      const { conn, deliverTo, destination, writes } = await setup('replace');
      const destinationId = await destination();
      conn.folders.add('/home/docs/other');
      await deliverTo(invoices(), { destinationId, folder: '/home/docs/other' });
      const note = await deliverTo(invoices(), { destinationId, folder: FOLDER });
      expect(note).toBe(`Wrote 3 files to ${FOLDER} on ${HOST}`);
      expect(writes()).toHaveLength(6);
    });

    it('writes again for a new spooled file with a reused job number', async () => {
      const { deliver, writes } = await setup('replace');
      await deliver(invoices());
      await db().update(runDeliveries).set({ splfCreated: '2026-10-16T08:00:00' });
      const note = await deliver(invoices());
      expect(note).toBe(`Wrote 3 files to ${FOLDER} on ${HOST} (3 replaced)`);
      expect(writes()).toHaveLength(6);
    });

    it('writes each file once when two runs of the same spooled file overlap', async () => {
      const { deliver, names, writes } = await setup('suffix');
      const results = await Promise.all([deliver(invoices()), deliver(invoices())]);
      expect(results.sort()[0]).toMatch(/, 3 were written in run #\d+$/);
      expect(writes()).toHaveLength(3);
      expect(names()).toEqual(['invoice-1001.pdf', 'invoice-1002.pdf', 'invoice-1003.pdf']);
    });
  });
});
