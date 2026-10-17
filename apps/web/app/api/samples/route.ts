import { checkFetchSite, json, workspaceErrorResponse } from '@/lib/server/http';
import { listSamples } from '@/lib/server/samples';

export const dynamic = 'force-dynamic';

/** The captured samples, newest first. */
export async function GET(request: Request): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  try {
    return json({ samples: await listSamples() });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
