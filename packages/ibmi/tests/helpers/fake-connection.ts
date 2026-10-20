import { readFileSync } from "node:fs";
import { sampleSchema, type Sample, type SpooledFileAttributes, type SpooledFileId } from "@spooldoc/core";
import {
  ConnectionError,
  type CommandResult,
  type Connection,
  type IfsEntry,
  type IfsWriteOptions,
  type OutputQueue,
  type QueueFileCount,
  type SpooledFileEntry,
  type SystemInfo,
} from "../../src/index.js";

export const FIXTURES = ["invoice", "order-report", "picklist", "picklist-xml"] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** Loads a core fixture sample. */
export function loadSample(name: FixtureName): Sample {
  const url = new URL(`../../../core/fixtures/${name}/sample.json`, import.meta.url);
  return sampleSchema.parse(JSON.parse(readFileSync(url, "utf8")));
}

const sameId = (a: SpooledFileId, b: SpooledFileId): boolean =>
  a.name === b.name && a.number === b.number && a.jobName === b.jobName && a.jobUser === b.jobUser && a.jobNumber === b.jobNumber;

/** Options to bend the fake: override attributes on read, or count calls. */
export interface FakeOptions {
  info?: Partial<SystemInfo>;
  attributes?: (attrs: SpooledFileAttributes) => SpooledFileAttributes;
}

/** A `Connection` backed by the core fixtures: their raw *SCS bytes and attributes. */
export class FakeConnection implements Connection {
  readonly samples: Sample[];
  readonly calls: string[] = [];
  /** Files in the IFS, by path, with the CCSID they were written with. */
  readonly ifs = new Map<string, { bytes: Uint8Array; ccsid: number }>();
  /** Folders in the IFS. */
  readonly folders = new Set<string>(["/"]);
  /** Methods that throw this error when called. */
  readonly failures = new Map<string, Error>();
  closed = false;
  constructor(
    names: readonly FixtureName[] = FIXTURES,
    private readonly options: FakeOptions = {},
  ) {
    this.samples = names.map(loadSample);
  }

  async describe(): Promise<SystemInfo> {
    this.calls.push("describe");
    return { host: "ibmi.example.com", user: "DEMOUSER", jobCcsid: 273, vrm: "V7R5", ...this.options.info };
  }

  async listOutputQueues(filter: { library?: string; name?: string } = {}): Promise<OutputQueue[]> {
    this.calls.push("listOutputQueues");
    const byQueue = new Map<string, OutputQueue>();
    for (const s of this.samples) {
      const { library, name } = s.attributes.queue;
      const q = byQueue.get(`${library}/${name}`) ?? { library, name, files: 0, text: "", dataQueue: null };
      q.files++;
      byQueue.set(`${library}/${name}`, q);
    }
    const has = (v: string, f?: string): boolean => !f || v.toUpperCase().includes(f.toUpperCase());
    return [...byQueue.values()]
      .filter((q) => has(q.library, filter.library) && has(q.name, filter.name))
      .sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name));
  }

  async listSpooledFiles(
    queue: { library: string; name: string },
    filter: { name?: string; userData?: string; limit?: number } = {},
  ): Promise<SpooledFileEntry[]> {
    this.calls.push("listSpooledFiles");
    return this.samples
      .filter((s) => s.attributes.queue.library === queue.library && s.attributes.queue.name === queue.name)
      .filter((s) => !filter.name || s.splf.name.includes(filter.name.toUpperCase()))
      .map((s) => ({ ...s.splf, status: "HELD", attributes: { ...s.attributes, chrid: null, jobCcsid: null } }))
      .slice(0, filter.limit ?? 200);
  }

  async countSpooledFiles(filter: { status: string[] }): Promise<QueueFileCount[]> {
    this.calls.push("countSpooledFiles");
    // Every fixture file is HELD, as in listSpooledFiles.
    const counts = new Map<string, QueueFileCount>();
    for (const s of filter.status.includes("HELD") ? this.samples : []) {
      const { library, name } = s.attributes.queue;
      const count = counts.get(`${library}/${name}`) ?? { library, name, status: "HELD", files: 0 };
      count.files++;
      counts.set(`${library}/${name}`, count);
    }
    return [...counts.values()];
  }

  async readSpooledFile(id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }> {
    this.calls.push("readSpooledFile");
    const s = this.samples.find((x) => sameId(x.splf, id));
    if (!s) throw new ConnectionError("notfound", `Spooled file ${id.name} number ${id.number} not found`);
    const attributes = this.options.attributes ? this.options.attributes(s.attributes) : s.attributes;
    return { bytes: new Uint8Array(Buffer.from(s.rawBase64, "base64")), attributes };
  }

  async holdSpooledFile(): Promise<void> {
    this.calls.push("holdSpooledFile");
  }

  async moveSpooledFile(): Promise<void> {
    this.calls.push("moveSpooledFile");
  }

  async deleteSpooledFile(): Promise<void> {
    this.calls.push("deleteSpooledFile");
  }

  async readDataQueue(): Promise<Uint8Array | null> {
    this.calls.push("readDataQueue");
    return null;
  }

  async runCommand(): Promise<CommandResult> {
    this.calls.push("runCommand");
    return { ok: true, messages: [] };
  }

  async ifsStat(path: string): Promise<IfsEntry | null> {
    this.calls.push("ifsStat");
    const failure = this.failures.get("ifsStat");
    if (failure) throw failure;
    return this.folders.has(path) ? "directory" : this.ifs.has(path) ? "file" : null;
  }

  async writeIfsFile(path: string, bytes: Uint8Array, { ccsid }: IfsWriteOptions): Promise<{ replaced: boolean }> {
    this.calls.push("writeIfsFile");
    const failure = this.failures.get("writeIfsFile");
    if (failure) throw failure;
    if (!this.folders.has(path.slice(0, path.lastIndexOf("/")) || "/")) {
      throw new ConnectionError("notfound", `The folder of ${path} does not exist.`);
    }
    const replaced = this.ifs.has(path);
    this.ifs.set(path, { bytes: new Uint8Array(bytes), ccsid });
    return { replaced };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
