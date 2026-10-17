import 'server-only';

import type { SpooledFileId, Workspace } from '@spooldoc/core';
import { getWorkspace } from './workspace';

/** One row of the samples list. */
export interface SampleSummary {
  id: string;
  splf: SpooledFileId;
  queue: { library: string; name: string };
  pages: number;
  codePage: number;
  definition: string | null;
  capturedAt: string;
}

/**
 * The samples in the workspace, newest capture first. A sample file that cannot be
 * read is left out.
 */
export async function listSamples(): Promise<SampleSummary[]> {
  const ws = getWorkspace();
  const ids = await ws.listSamples();
  const rows = await Promise.all(
    ids.map(async (id): Promise<SampleSummary | null> => {
      const sample = await ws.readSample(id).catch(() => null);
      if (!sample) {
        return null;
      }
      return {
        id: sample.id,
        splf: sample.splf,
        queue: sample.attributes.queue,
        pages: sample.pages.length,
        codePage: sample.codePage,
        definition: sample.definition ?? null,
        capturedAt: sample.capturedAt,
      };
    }),
  );
  return rows
    .filter((row): row is SampleSummary => row !== null)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id));
}

/**
 * Link a sample to a definition type. The definition file does not have to exist yet.
 *
 * @param id - Sample id
 * @param type - Definition type name
 * @param ws - The workspace (default: the configured one)
 * @returns False when there is no such sample
 * @throws WorkspaceError for an invalid id
 */
export async function linkDefinition(id: string, type: string, ws: Workspace = getWorkspace()): Promise<boolean> {
  const sample = await ws.readSample(id);
  if (!sample) {
    return false;
  }
  if (sample.definition !== type) {
    await ws.writeSample({ ...sample, definition: type });
  }
  return true;
}
