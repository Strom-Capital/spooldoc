import { readFileSync } from 'node:fs';
import { sampleSchema, type Sample, type SpooledFileAttributes, type SpooledFileId } from '@spooldoc/core';
import {
  ConnectionError,
  type CommandResult,
  type Connection,
  type OutputQueue,
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

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** The password the fake jt400 driver accepts. */
export const GOOD_PASSWORD = 'right-Passw0rd';
