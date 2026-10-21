import { ConnectionError } from '@spooldoc/ibmi';
import { describe, expect, it, vi } from 'vitest';
import type { IfExists } from '@/lib/destination-config';
import { ifsDestination } from '@/lib/server/destinations/ifs';
import type { RunFile } from '@/lib/server/destinations/store';
import { FakeConnection } from './helpers/fake-connection';

const FOLDER = '/home/docs/out';
const HOST = 'ibmi.example.com';
const OLD = new Uint8Array([1]);

const file = (name: string, byte = 9): RunFile => ({
  pageGroupIndex: 0,
  template: 'Invoice',
  templateIndex: 0,
  name,
  contentType: 'application/pdf',
  content: new Uint8Array([byte]),
});

function setup(ifExists: IfExists, existing: string[] = []) {
  const conn = new FakeConnection();
  conn.folders.add(FOLDER);
  for (const name of existing) conn.ifs.set(`${FOLDER}/${name}`, { bytes: OLD, ccsid: 65535 });
  const deliver = (files: RunFile[]) => ifsDestination({ folder: FOLDER, ifExists, keepCopy: false }).deliver({ runId: 'run-1', files, documents: [], job: { id: 'job-1', splfKey: 'key' }, destinationId: 'destination-1', email: null, valueTypes: {}, conn, host: HOST, addSecret: () => undefined });
  const names = () => [...conn.ifs.keys()].map((path) => path.slice(FOLDER.length + 1)).sort();
  const writes = () => conn.calls.filter((call) => call.method === 'writeIfsFile').map((call) => call.args);
  return { conn, deliver, names, writes };
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
      const { deliver, writes } = setup(mode);
      await deliver([file('invoice-1001.pdf')]);
      expect(writes()[0]![1]).toEqual({ ccsid: 65535, ifExists });
    }
  });

  it('gives a number to a name that differs only in case from another of the run, in every mode', async () => {
    for (const mode of ['replace', 'fail', 'suffix'] as const) {
      const { deliver, names, conn } = setup(mode);
      const note = await deliver([file('Acme.pdf', 1), file('ACME.pdf', 2)]);
      expect(names()).toEqual(['ACME-2.pdf', 'Acme.pdf']);
      expect(conn.ifs.get(`${FOLDER}/Acme.pdf`)?.bytes).toEqual(new Uint8Array([1]));
      expect(conn.ifs.get(`${FOLDER}/ACME-2.pdf`)?.bytes).toEqual(new Uint8Array([2]));
      expect(note).toBe(`Wrote 2 files to ${FOLDER} on ${HOST} (1 with a number added)`);
    }
  });

  it('does not number a case-only name onto another file of the run', async () => {
    const { deliver, names } = setup('replace');
    await deliver([file('a.pdf'), file('A.pdf'), file('a-2.pdf')]);
    expect(names()).toEqual(['A-3.pdf', 'a-2.pdf', 'a.pdf']);
  });

  it('fails the run before writing when a name is taken in another case', async () => {
    const { deliver, writes } = setup('fail', ['INVOICE-1001.PDF']);
    await expect(deliver([file('invoice-1001.pdf')])).rejects.toThrow(`invoice-1001.pdf is already in ${FOLDER}. Nothing was written.`);
    expect(writes()).toEqual([]);
  });

  it('adds a number past a name taken in another case', async () => {
    const { deliver, names } = setup('suffix', ['INVOICE-1001.PDF', 'Invoice-1001-2.pdf']);
    await deliver([file('invoice-1001.pdf')]);
    expect(names()).toEqual(['INVOICE-1001.PDF', 'Invoice-1001-2.pdf', 'invoice-1001-3.pdf']);
  });

  it('in Fail the run, does not replace a file that appears after the check, and says what was written', async () => {
    const { conn, deliver, names } = setup('fail');
    const write = conn.writeIfsFile.bind(conn);
    let calls = 0;
    vi.spyOn(conn, 'writeIfsFile').mockImplementation(async (path, bytes, options) => {
      if (++calls === 2) conn.ifs.set(`${FOLDER}/invoice-1002.pdf`, { bytes: OLD, ccsid: 65535 });
      return write(path, bytes, options);
    });
    const err = await deliver([file('invoice-1001.pdf'), file('invoice-1002.pdf')]).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `Wrote 1 of 2 files to ${FOLDER}, then: invoice-1002.pdf is already in ${FOLDER}: another run or program wrote it after this run looked. It was not replaced. Change "When a file with the same name exists" or move the old file.`,
    );
    expect(conn.ifs.get(`${FOLDER}/invoice-1002.pdf`)?.bytes).toEqual(OLD);
    expect(names()).toEqual(['invoice-1001.pdf', 'invoice-1002.pdf']);
  });

  it('in Add a number, takes the next number when the name is taken after the check', async () => {
    const { conn, deliver, names } = setup('suffix', ['invoice-1001.pdf']);
    appearsBeforeWrite(conn, 'invoice-1001-2.pdf');
    const note = await deliver([file('invoice-1001.pdf', 7)]);
    expect(names()).toEqual(['invoice-1001-2.pdf', 'invoice-1001-3.pdf', 'invoice-1001.pdf']);
    expect(conn.ifs.get(`${FOLDER}/invoice-1001-3.pdf`)?.bytes).toEqual(new Uint8Array([7]));
    expect(conn.ifs.get(`${FOLDER}/invoice-1001-2.pdf`)?.bytes).toEqual(OLD);
    expect(note).toBe(`Wrote 1 file to ${FOLDER} on ${HOST} (1 with a number added)`);
  });

  it('in Add a number, numbers a name that was free at the check and taken at the write', async () => {
    const { conn, deliver, names } = setup('suffix');
    appearsBeforeWrite(conn, 'invoice-1001.pdf');
    await deliver([file('invoice-1001.pdf')]);
    expect(names()).toEqual(['invoice-1001-2.pdf', 'invoice-1001.pdf']);
  });

  it('in Replace, replaces a file that appears after the check', async () => {
    const { conn, deliver } = setup('replace');
    appearsBeforeWrite(conn, 'invoice-1001.pdf');
    const note = await deliver([file('invoice-1001.pdf', 7)]);
    expect(conn.ifs.get(`${FOLDER}/invoice-1001.pdf`)?.bytes).toEqual(new Uint8Array([7]));
    expect(note).toBe(`Wrote 1 file to ${FOLDER} on ${HOST} (1 replaced)`);
  });

  it('says when a replaced file was left over', async () => {
    const { conn, deliver } = setup('replace', ['invoice-1001.pdf']);
    vi.spyOn(conn, 'writeIfsFile').mockResolvedValueOnce({ replaced: true, leftover: `${FOLDER}/.invoice-1001.pdf.0a0b0c0d.old` });
    const note = await deliver([file('invoice-1001.pdf')]);
    expect(note).toBe(
      `Wrote 1 file to ${FOLDER} on ${HOST} (1 replaced). The replaced file was kept as ${FOLDER}/.invoice-1001.pdf.0a0b0c0d.old, since it could not be deleted. Delete it`,
    );
  });

  it('keeps the error of a write that fails for another reason', async () => {
    const { conn, deliver } = setup('replace');
    vi.spyOn(conn, 'writeIfsFile').mockRejectedValueOnce(new ConnectionError('other', 'The new file could not be renamed.', { detail: 'CPFA0B1' }));
    await expect(deliver([file('invoice-1001.pdf')])).rejects.toMatchObject({ message: 'The new file could not be renamed.', detail: 'CPFA0B1' });
  });
});
