import { readFileSync } from 'node:fs';
import { sampleSchema, type Sample, type SpooledFileAttributes, type SpooledFileId } from '@spooldoc/core';
import {
  ConnectionError,
  type CommandResult,
  type Connection,
  type IfsEntry,
  type IfsWriteOptions,
  type IfsWriteResult,
  type OutputQueue,
  type QueueFileCount,
  type QueueFileCountFilter,
  type QueueRef,
  type SpooledFileEntry,
  type SpooledFileFilter,
  type SystemInfo,
} from '@spooldoc/ibmi';

export const FIXTURES = ['invoice', 'order-report', 'picklist', 'picklist-xml'] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** A core fixture sample. */
export function loadSample(name: FixtureName): Sample {
  const url = new URL(`../../../../packages/core/fixtures/${name}/sample.json`, import.meta.url);
  return sampleSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/** A core fixture file as text. */
export function fixtureText(name: FixtureName, file: string): string {
  return readFileSync(new URL(`../../../../packages/core/fixtures/${name}/${file}`, import.meta.url), 'utf8');
}

const sameId = (a: SpooledFileId, b: SpooledFileId): boolean =>
  a.name === b.name && a.number === b.number && a.jobName === b.jobName && a.jobUser === b.jobUser && a.jobNumber === b.jobNumber;

/** A call that acts on a spooled file or the system, recorded for assertions. */
export interface FakeCall {
  method: string;
  args: unknown[];
}

/**
 * A `Connection` over the core fixtures: their raw *SCS bytes and attributes. Statuses,
 * data queues, data queue entries, command results and failures can be set per test.
 */
export class FakeConnection implements Connection {
  readonly samples: Sample[] = FIXTURES.map(loadSample);
  readonly calls: FakeCall[] = [];
  /** Status per spooled file key (`splfKey`); default HELD. */
  readonly status = new Map<string, string>();
  /** Data queue per `LIB/QUEUE`. */
  readonly dataQueues = new Map<string, QueueRef>();
  /** Entries waiting on data queues, per `LIB/NAME`. */
  readonly entries = new Map<string, Uint8Array[]>();
  /** Methods that throw this error when called. */
  readonly failures = new Map<string, Error>();
  /** Files in the IFS, by path, with the CCSID they were written with. */
  readonly ifs = new Map<string, { bytes: Uint8Array; ccsid: number }>();
  /** Folders in the IFS. */
  readonly folders = new Set<string>(['/']);
  /** What `runCommand` answers. */
  commandResult: (command: string) => CommandResult = () => ({ ok: true, messages: [] });
  closed = false;

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    const failure = this.failures.get(method);
    if (failure) throw failure;
  }

  /** The spooled-file actions called so far, such as `holdSpooledFile`. */
  actions(): string[] {
    return this.calls.map((call) => call.method).filter((method) => /SpooledFile$/.test(method) && method !== 'readSpooledFile');
  }

  async describe(): Promise<SystemInfo> {
    return { host: 'ibmi.example.com', user: 'DEMOUSER', jobCcsid: 273, vrm: 'V7R5' };
  }

  async listOutputQueues(filter: { library?: string; name?: string; libraries?: string[] } = {}): Promise<OutputQueue[]> {
    this.record('listOutputQueues', filter);
    const byQueue = new Map<string, OutputQueue>();
    for (const s of this.samples) {
      const { library, name } = s.attributes.queue;
      const q = byQueue.get(`${library}/${name}`) ?? { library, name, files: 0, text: '', dataQueue: this.dataQueues.get(`${library}/${name}`) ?? null };
      q.files++;
      byQueue.set(`${library}/${name}`, q);
    }
    const has = (v: string, f?: string): boolean => !f || v.toUpperCase().includes(f.toUpperCase());
    const libraries = filter.libraries ?? [];
    return [...byQueue.values()].filter(
      (q) => has(q.library, filter.library) && has(q.name, filter.name) && (libraries.length === 0 || libraries.includes(q.library)),
    );
  }

  async listSpooledFiles(queue: { library: string; name: string }, filter: SpooledFileFilter = {}): Promise<SpooledFileEntry[]> {
    this.record('listSpooledFiles', queue, filter);
    const key = (s: Sample) => `${s.splf.name}/${s.splf.number}/${s.splf.jobNumber}/${s.splf.jobUser}/${s.splf.jobName}`;
    return this.samples
      .filter((s) => s.attributes.queue.library === queue.library && s.attributes.queue.name === queue.name)
      .filter((s) => !filter.name || s.splf.name.includes(filter.name.toUpperCase()))
      .filter((s) => !filter.userData || s.attributes.userData.toUpperCase().includes(filter.userData.toUpperCase()))
      .map((s) => ({ ...s.splf, status: this.status.get(key(s)) ?? 'HELD', attributes: { ...s.attributes, chrid: null, jobCcsid: null } }))
      .filter((entry) => !filter.status?.length || filter.status.includes(entry.status))
      .slice(0, filter.limit ?? 200);
  }

  async countSpooledFiles(filter: QueueFileCountFilter): Promise<QueueFileCount[]> {
    this.record('countSpooledFiles', filter);
    const key = (s: Sample) => `${s.splf.name}/${s.splf.number}/${s.splf.jobNumber}/${s.splf.jobUser}/${s.splf.jobName}`;
    const libraries = filter.libraries ?? [];
    const counts = new Map<string, QueueFileCount>();
    for (const s of this.samples) {
      const { library, name } = s.attributes.queue;
      const status = this.status.get(key(s)) ?? 'HELD';
      if (!filter.status.includes(status) || (libraries.length > 0 && !libraries.includes(library))) continue;
      const count = counts.get(`${library}/${name}/${status}`) ?? { library, name, status, files: 0 };
      count.files++;
      counts.set(`${library}/${name}/${status}`, count);
    }
    return [...counts.values()];
  }

  async readSpooledFile(id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }> {
    this.record('readSpooledFile', id);
    const s = this.samples.find((x) => sameId(x.splf, id));
    if (!s) throw new ConnectionError('notfound', `Spooled file ${id.name} number ${id.number} not found`);
    return { bytes: new Uint8Array(Buffer.from(s.rawBase64, 'base64')), attributes: s.attributes };
  }

  async holdSpooledFile(id: SpooledFileId): Promise<void> {
    this.record('holdSpooledFile', id);
  }

  async moveSpooledFile(id: SpooledFileId, queue: QueueRef): Promise<void> {
    this.record('moveSpooledFile', id, queue);
  }

  async deleteSpooledFile(id: SpooledFileId): Promise<void> {
    this.record('deleteSpooledFile', id);
  }

  async readDataQueue(dataQueue: QueueRef, waitSeconds: number): Promise<Uint8Array | null> {
    this.record('readDataQueue', dataQueue, waitSeconds);
    const entry = this.entries.get(`${dataQueue.library}/${dataQueue.name}`)?.shift();
    // A real read waits for an entry; a short pause keeps a reader loop from spinning.
    if (!entry) await new Promise((resolve) => setTimeout(resolve, 5));
    return entry ?? null;
  }

  async runCommand(command: string): Promise<CommandResult> {
    this.record('runCommand', command);
    return this.commandResult(command);
  }

  /**
   * The key of the file at `path`, if there is one. Like the IFS, names outside /QOpenSys
   * ignore case: `ACME.pdf` is the file `Acme.pdf`.
   */
  ifsFileAt(path: string): string | undefined {
    if (this.ifs.has(path) || path.startsWith('/QOpenSys/')) return this.ifs.has(path) ? path : undefined;
    const lower = path.toLowerCase();
    return [...this.ifs.keys()].find((key) => key.toLowerCase() === lower);
  }

  async ifsStat(path: string): Promise<IfsEntry | null> {
    this.record('ifsStat', path);
    return this.folders.has(path) ? 'directory' : this.ifsFileAt(path) ? 'file' : null;
  }

  /**
   * Writes like the real one: the folder must exist, and a file with the same name is
   * replaced, or with `ifExists: 'fail'` left alone with an "exists" error.
   */
  async writeIfsFile(path: string, bytes: Uint8Array, options: IfsWriteOptions): Promise<IfsWriteResult> {
    this.record('writeIfsFile', path, options);
    const folder = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!this.folders.has(folder)) {
      throw new ConnectionError('notfound', `The folder of ${path} does not exist on ibmi.example.com.`);
    }
    const old = this.ifsFileAt(path);
    if (old && options.ifExists === 'fail') {
      throw new ConnectionError('exists', `${path.slice(folder.length + 1)} is already in ${folder}. It was not replaced.`);
    }
    if (old) this.ifs.delete(old);
    this.ifs.set(path, { bytes: new Uint8Array(bytes), ccsid: options.ccsid });
    return { replaced: old !== undefined };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** The password the fake jt400 driver accepts. */
export const GOOD_PASSWORD = 'right-Passw0rd';
