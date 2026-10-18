import { z } from 'zod';
import { getConfig } from '@/lib/server/config';
import { checkFetchSite, checkOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { closeSessionConnection, connectionErrorResponse, signOn } from '@/lib/server/ibmi';
import { describeModel } from '@/lib/server/models';
import { pdfAvailable } from '@/lib/server/pdf';
import { getSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const connectSchema = z.object({
  host: z.string().trim().min(1, 'Enter the host').max(255),
  user: z.string().trim().min(1, 'Enter the user profile').max(10, 'A user profile has at most 10 characters'),
  password: z.string().min(1, 'Enter the password').max(128),
  library: z
    .string()
    .trim()
    .max(10, 'A library name has at most 10 characters')
    .optional()
    .transform((value) => value?.toUpperCase() || undefined),
});

/** Sign on to an IBM i: open the connection, check it with describe(), keep the sign-on in the session. */
export async function POST(request: Request): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  const body = await readJson(request, connectSchema);
  if ('response' in body) {
    return body.response;
  }
  const { host, user, password, library } = body.data;
  const allowed = getConfig().allowedHosts;
  if (allowed.length > 0 && !allowed.includes(host.toLowerCase())) {
    return errorResponse(400, 'This host is not in SPOOLDOC_ALLOWED_HOSTS.');
  }
  const session = await getSession();
  if (session.ibmi) {
    await closeSessionConnection().catch(() => undefined);
  }
  try {
    const info = await signOn({ host, user: user.toUpperCase(), password });
    session.ibmi = { host, user: user.toUpperCase(), password, library, connectedAt: new Date().toISOString() };
    await session.save();
    return json({ host: info.host, user: info.user, jobCcsid: info.jobCcsid, vrm: info.vrm }, { status: 201 });
  } catch (error) {
    session.destroy();
    return connectionErrorResponse(error, [password]);
  }
}

/** Whether this browser is connected, which model the server has (never a key), masking and PDF support. */
export async function GET(request: Request): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const session = await getSession();
  const ibmi = session.ibmi;
  return json({
    connected: !!ibmi,
    ...(ibmi ? { host: ibmi.host, user: ibmi.user, library: ibmi.library } : {}),
    model: describeModel(),
    masking: getConfig().mask,
    pdf: await pdfAvailable(),
  });
}

/** Close the cached connection and forget the sign-on. */
export async function DELETE(request: Request): Promise<Response> {
  const refused = checkOrigin(request);
  if (refused) {
    return refused;
  }
  await closeSessionConnection().catch(() => undefined);
  const session = await getSession();
  session.destroy();
  return new Response(null, { status: 204 });
}
