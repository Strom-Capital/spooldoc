import { readFileSync } from 'node:fs';
import { sampleSchema, type Sample, type SpooledFileAttributes, type SpooledFileId } from '@spooldoc/core';
import { ConnectionError, type Connection, type OutputQueue, type SpooledFileEntry, type SystemInfo } from '@spooldoc/ibmi';

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

/** A `Connection` over the core fixtures: their raw *SCS bytes and attributes. */
export class FakeConnection implements Connection {
  readonly samples: Sample[] = FIXTURES.map(loadSample);
  closed = false;

  async describe(): Promise<SystemInfo> {
    return { host: 'ibmi.example.com', user: 'DEMOUSER', jobCcsid: 273, vrm: 'V7R5' };
  }

  async listOutputQueues(filter: { library?: string; name?: string } = {}): Promise<OutputQueue[]> {
    const byQueue = new Map<string, OutputQueue>();
    for (const s of this.samples) {
      const { library, name } = s.attributes.queue;
      const q = byQueue.get(`${library}/${name}`) ?? { library, name, files: 0, text: '' };
      q.files++;
      byQueue.set(`${library}/${name}`, q);
    }
    const has = (v: string, f?: string): boolean => !f || v.toUpperCase().includes(f.toUpperCase());
    return [...byQueue.values()].filter((q) => has(q.library, filter.library) && has(q.name, filter.name));
  }

  async listSpooledFiles(queue: { library: string; name: string }): Promise<SpooledFileEntry[]> {
    return this.samples
      .filter((s) => s.attributes.queue.library === queue.library && s.attributes.queue.name === queue.name)
      .map((s) => ({ ...s.splf, status: 'HELD', attributes: { ...s.attributes, chrid: null, jobCcsid: null } }));
  }

  async readSpooledFile(id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }> {
    const s = this.samples.find((x) => sameId(x.splf, id));
    if (!s) throw new ConnectionError('notfound', `Spooled file ${id.name} number ${id.number} not found`);
    return { bytes: new Uint8Array(Buffer.from(s.rawBase64, 'base64')), attributes: s.attributes };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** The password the fake jt400 driver accepts. */
export const GOOD_PASSWORD = 'right-Passw0rd';
