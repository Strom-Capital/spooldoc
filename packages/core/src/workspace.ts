import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sampleSchema, type Sample } from "./sample.js";

/** Thrown for an invalid name or an unreadable workspace file. */
export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/** Files and folders of a workspace. */
export interface WorkspacePaths {
  root: string;
  samples: string;
  definitions: string;
  templates: string;
  sample(id: string): string;
  definition(type: string): string;
  template(type: string): string;
}

/** A workspace folder with samples, definitions and templates. */
export interface Workspace {
  root: string;
  paths: WorkspacePaths;
  listSamples(): Promise<string[]>;
  readSample(id: string): Promise<Sample | null>;
  writeSample(sample: Sample): Promise<void>;
  readDefinition(type: string): Promise<string | null>;
  writeDefinition(type: string, yaml: string): Promise<void>;
  readTemplate(type: string): Promise<string | null>;
  writeTemplate(type: string, html: string): Promise<void>;
}

const NAME = /^[A-Za-z0-9._-]+$/;

/** Throws `WorkspaceError` unless `name` is a safe file name (no paths, no `..`). */
export function checkName(name: string): string {
  if (!NAME.test(name) || name.includes("..") || name.startsWith(".")) {
    throw new WorkspaceError(`Invalid name ${JSON.stringify(name)}: use letters, digits, '.', '_' and '-'`);
  }
  return name;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Writes a file atomically: a temp file in the same folder, then a rename. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  const dir = resolve(path, "..");
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Opens a workspace at `root`. Folders are created when first written. */
export function openWorkspace(root: string): Workspace {
  const abs = resolve(root);
  const paths: WorkspacePaths = {
    root: abs,
    samples: join(abs, "samples"),
    definitions: join(abs, "definitions"),
    templates: join(abs, "templates"),
    sample: (id) => join(abs, "samples", `${checkName(id)}.json`),
    definition: (type) => join(abs, "definitions", `${checkName(type)}.yaml`),
    template: (type) => join(abs, "templates", `${checkName(type)}.html`),
  };
  return {
    root: abs,
    paths,
    async listSamples() {
      let names: string[];
      try {
        // The comment keeps Next.js from tracing the whole project when it bundles this module.
        names = await readdir(/* turbopackIgnore: true */ paths.samples);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      return names
        .filter((n) => n.endsWith(".json") && !n.startsWith("."))
        .map((n) => n.slice(0, -".json".length))
        .sort();
    },
    async readSample(id) {
      const text = await readOrNull(paths.sample(id));
      if (text === null) return null;
      const parsed = sampleSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new WorkspaceError(`Sample ${id} is not valid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
      return parsed.data;
    },
    async writeSample(sample) {
      const valid = sampleSchema.parse(sample);
      await writeAtomic(paths.sample(valid.id), `${JSON.stringify(valid, null, 2)}\n`);
    },
    readDefinition: async (type) => readOrNull(paths.definition(type)),
    writeDefinition: async (type, yaml) => writeAtomic(paths.definition(type), yaml),
    readTemplate: async (type) => readOrNull(paths.template(type)),
    writeTemplate: async (type, html) => writeAtomic(paths.template(type), html),
  };
}
