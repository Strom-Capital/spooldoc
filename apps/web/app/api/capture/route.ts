import { resolveCodePage, spooledFileIdSchema, type Sample } from '@spooldoc/core';
import { captureSample } from '@spooldoc/ibmi';
import { z } from 'zod';
import { getConfig } from '@/lib/server/config';
import { checkOrigin, errorResponse, json, readJson, redact } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { getWorkspace } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';

const captureRequest = z.object({ splf: spooledFileIdSchema });

/**
 * Capture a spooled file into the workspace as a sample. The sample is not scrubbed:
 * the workspace is private. A sample captured again keeps its linked definition.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const body = await readJson(request, captureRequest);
  if ('response' in body) {
    return body.response;
  }
  const fallbackCodePage = getConfig().defaultCcsid;
  return withConnection(async (conn, ibmi) => {
    let captured: { sample: Sample; warnings: string[] };
    try {
      captured = await captureSample(conn, body.data.splf, { system: ibmi.host, fallbackCodePage });
    } catch (error) {
      if (error instanceof Error && error.name === 'UnsupportedCodePageError') {
        return errorResponse(422, `${error.message}. Set SPOOLDOC_DEFAULT_CCSID to decode it anyway.`);
      }
      throw error;
    }
    const ws = getWorkspace();
    const { sample, warnings } = captured;
    try {
      const existing = await ws.readSample(sample.id).catch(() => null);
      await ws.writeSample(existing?.definition ? { ...sample, definition: existing.definition } : sample);
    } catch (error) {
      return errorResponse(500, `The sample could not be written: ${redact(error, [ibmi.password])}`);
    }
    const { source } = resolveCodePage(sample.attributes, fallbackCodePage);
    return json(
      { id: sample.id, pages: sample.pages.length, codePage: sample.codePage, codePageSource: source, warnings },
      { status: 201 },
    );
  });
}
