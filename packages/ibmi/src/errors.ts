import { ConnectionError, type ConnectionErrorCode } from "./connection.js";

/**
 * A connection that was open and is not any more: the JDBC states 08003 and 08S01, or the
 * socket's own words. It is a host error, since the connection is the problem, not an object.
 */
const LOST = /\b08003\b|\b08S01\b|connection does not exist|Communication link failure|Connection reset|Socket closed|Broken pipe|Connection dropped unexpectedly/i;

/** True when an error text says that an open connection dropped, rather than that one could not be opened. */
export function isConnectionLost(text: string): boolean {
  return LOST.test(text);
}

const RULES: [ConnectionErrorCode, RegExp][] = [
  [
    "auth",
    /AS400SecurityException|password (is )?(not correct|incorrect|expired|not set)|user (id|profile) (is )?(not known|disabled|does not exist)|profile [^\n]{0,200}disabled|CPF22E[2-5]|CPF2204|SQL30082|\b08004\b/i,
  ],
  [
    "host",
    /UnknownHostException|nodename nor servname|Name or service not known|ConnectException|Connection refused|NoRouteToHost|SocketTimeoutException|timed out|cannot establish the connection|\b08001\b/i,
  ],
  // Before notfound, which would take "The connection does not exist." for a missing object.
  ["host", LOST],
  ["authority", /CPF3401|CPF2189|CPF2182|CPF2207|CPF3C52|not authorized|SQL0551|SQL0552/i],
  ["notfound", /CPF3C40|CPF3344|CPF3342|CPF3330|CPF2105|CPF2110|ObjectDoesNotExistException|not found|does not exist|no longer in the system|SQL0204/i],
];

/**
 * Rules for an IFS call. jt400 reports a missing authority on a folder as an
 * `AS400SecurityException`, which the general rules take for a failed sign-on. Here only
 * a password or profile problem is a sign-on problem.
 */
const IFS_RULES: [ConnectionErrorCode, RegExp][] = [
  [
    "auth",
    /password (is )?(not correct|incorrect|expired|not set)|user (id|profile) (is )?(not known|disabled|does not exist)|profile [^\n]{0,200}disabled|CPF22E[2-5]|CPF2204/i,
  ],
  ...RULES.filter(([code]) => code === "host"),
  ["authority", /AS400SecurityException|access (to (the )?request )?(was |is )?denied|not authorized|permission denied|CPFA0B1|CPFA09C|CPF3401/i],
  ["notfound", /(file|path|directory|object) not found|no such (path|file|directory)|does not exist|CPFA0A9|CPFA0A7/i],
];

/** Whether a context is about the IFS, such as "IFS /home/docs/out/invoice-1001.pdf". */
const isIfs = (context?: string): boolean => context?.startsWith("IFS ") ?? false;

/**
 * Classifies an error text into a `ConnectionError` code.
 *
 * @param context - What was being done; an IFS call is classified with its own rules
 */
export function classifyError(text: string, context?: string): ConnectionErrorCode {
  for (const [code, re] of isIfs(context) ? IFS_RULES : RULES) if (re.test(text)) return code;
  return "other";
}

/** Replaces every occurrence of each secret (case-sensitive and upper-cased) with `***`. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const s of new Set([secret, secret.toUpperCase(), secret.toLowerCase(), encodeURIComponent(secret)])) {
      out = out.split(s).join("***");
    }
  }
  return out;
}

type JavaThrowable = { toStringSync(): string; getCauseSync?(): unknown };

function isJavaThrowable(value: unknown): value is JavaThrowable {
  return typeof value === "object" && value !== null && typeof (value as JavaThrowable).toStringSync === "function";
}

/** The message of one link in a cause chain and the next link: a JS `Error` or a Java `Throwable` proxy. */
function causeLink(cause: unknown): [string, unknown] {
  if (cause instanceof Error) return [cause.message, (cause as { cause?: unknown }).cause];
  if (isJavaThrowable(cause)) {
    try {
      return [cause.toStringSync(), cause.getCauseSync?.()];
    } catch {
      return ["", undefined];
    }
  }
  return [typeof cause === "object" ? "" : String(cause), undefined];
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    let cause: unknown = (err as { cause?: unknown }).cause;
    for (let i = 0; i < 4 && cause; i++) {
      const [text, next] = causeLink(cause);
      parts.push(text);
      cause = next;
    }
    return parts.filter(Boolean).join("\n");
  }
  return String(err);
}

const HOST_REASONS: [string, RegExp][] = [
  ["connection refused", /Connection refused|ConnectException/i],
  ["no route to host", /NoRouteToHost|No route to host/i],
  ["connection timed out", /SocketTimeoutException|timed out/i],
  ["unknown host", /UnknownHostException|nodename nor servname|Name or service not known|cannot establish the connection\. \([^()\s]+\)/i],
];

/**
 * A readable message for an unreachable system, such as "Cannot reach
 * ibmi.example.com: unknown host", from the Java exception text, or "The connection to
 * ibmi.example.com dropped" for a connection that was open. The host comes from
 * an `UnknownHostException` or from the JDBC driver's "(host)" detail; without one
 * the message names `fallbackHost`, else "the system". Undefined when no reason is recognized.
 */
export function hostMessage(text: string, fallbackHost?: string): string | undefined {
  if (isConnectionLost(text)) return `The connection to ${fallbackHost ?? "the system"} dropped`;
  const reason = HOST_REASONS.find(([, re]) => re.test(text))?.[0];
  if (!reason) return undefined;
  const host =
    /UnknownHostException:\s*([^\s:]+)/.exec(text)?.[1] ??
    /cannot establish the connection\. \(([^()\s]+)\)/i.exec(text)?.[1] ??
    fallbackHost ??
    "the system";
  return `Cannot reach ${host}: ${reason}`;
}

/**
 * The readable part of a Java bridge message: the text after the last
 * `java.x.SomeException:` style prefix, without stack frames.
 */
export function summarize(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("at ") && !/^\.\.\. \d+ more$/.test(l));
  let best = "";
  for (const line of lines) {
    const m = /^(?:Caused by: )?(?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error):\s*(\S.*)$/.exec(line);
    if (m?.[1]) best = m[1];
  }
  const out = best || lines[0] || "Unknown error";
  return out.length > 500 ? `${out.slice(0, 497)}...` : out;
}

/** The first IBM i message ID in an error text, such as `CPF2204` or `SQL0551`. */
export function messageIdOf(text: string): string | undefined {
  return /\b(CP[FDI][0-9A-F]{4}|SQL\d{4,5}|MCH\d{4})\b/.exec(text)?.[1];
}

/** The system and user profile an error is about, to name them in the message. */
export interface ErrorTarget {
  host?: string;
  user?: string;
}

/** An object named in a CPF or SQL message: "X in LIB type *OUTQ". */
function objectOf(text: string): { name: string; library: string; type: string } | undefined {
  const m = /(?:object\s+)?([A-Z0-9_$#@.]{1,30}) in (?:library\s+)?([A-Z0-9_$#@]{1,10}) type (\*[A-Z]{1,10})/i.exec(text);
  return m ? { name: m[1]!.toUpperCase(), library: m[2]!.toUpperCase(), type: m[3]!.toUpperCase() } : undefined;
}

/** A library named in a CPF message: "Library X not found." or "Not authorized to library X." */
function libraryOf(text: string): string | undefined {
  return /(?:\bLibrary ([A-Z0-9_$#@]+) not found|Not authorized to library ([A-Z0-9_$#@]+))/i.exec(text)?.slice(1).find(Boolean)?.toUpperCase();
}

const OBJECT_TYPES: Record<string, string> = {
  "*OUTQ": "output queue",
  "*DTAQ": "data queue",
  "*LIB": "library",
  "*FILE": "file",
  "*USRPRF": "user profile",
};

const PORTS = "ports 449 and 8470 to 8476";

/**
 * What to tell the user about an IBM i error: what went wrong, in their terms, and what
 * to do next. One line, since run and watch errors keep the first line. Undefined when
 * there is nothing better to say than the system's own text.
 *
 * @param code - The class from `classifyError`
 * @param text - The full error text, already redacted
 * @param context - What was being done, such as "Spooled file X number 1 of job ..."
 * @param target - The host and user profile, when known
 */
export function guidance(code: ConnectionErrorCode, text: string, context?: string, target: ErrorTarget = {}): string | undefined {
  const user = target.user?.trim().toUpperCase();
  const host = target.host?.trim();
  const profile = user ?? "the user profile";
  const system = host ?? "the IBM i";
  const System = host ?? "The IBM i";
  const Profile = user ?? "The user profile";

  switch (code) {
    case "auth":
      if (/CPF22E3|profile (is )?disabled|profile [^\n]{0,200}disabled/i.test(text)) {
        return `${user ? `The user profile ${user} is` : "The user profile is"} disabled on ${system}. A security officer can enable it with CHGUSRPRF USRPRF(${user ?? "name"}) STATUS(*ENABLED).`;
      }
      if (/CPF22E4|password (has )?expired/i.test(text)) {
        return `The password of ${profile} has expired. Set a new one on the IBM i, then enter it for the server on the Servers page.`;
      }
      if (/CPF22E5|no password associated|password (is )?not set/i.test(text)) {
        return `${Profile} has no password (PASSWORD(*NONE)), so it cannot sign on. Use a user profile with a password.`;
      }
      if (/CPF2204|user (id|profile) (is )?(not known|does not exist)|user profile [^\n]{0,200} not found/i.test(text)) {
        return `There is no user profile ${user ?? "with that name"} on ${system}. Check the user on the Servers page.`;
      }
      if (/CPF22E2|password (is )?(not correct|incorrect)/i.test(text)) {
        return `${System} did not accept the password for ${profile}. Check it on the Servers page; repeated wrong passwords can disable the profile.`;
      }
      return `${System} did not accept the user profile or password. Check them on the Servers page.`;

    case "host": {
      const reached = hostMessage(text, host);
      if (isConnectionLost(text)) {
        return `${reached}. Spooldoc connects again on the next try. If it keeps failing, check the network or VPN to ${system}.`;
      }
      if (!reached) return `Cannot reach ${system}. Check the host name on the Servers page, the network, and that a firewall lets ${PORTS} through.`;
      if (/unknown host/.test(reached)) return `${reached}. Check the host name on the Servers page.`;
      if (/refused/.test(reached)) return `${reached}. Check that the host servers run on the IBM i (STRHOSTSVR SERVER(*ALL)) and that ${PORTS} are open.`;
      return `${reached}. Check the network and that a firewall lets ${PORTS} through.`;
    }

    case "authority": {
      if (isIfs(context)) {
        const { path, folder, writing } = ifsTarget(context!);
        if (!writing) return `${Profile} needs *X authority on every folder in ${path}. A security officer can grant it with CHGAUT, for example CHGAUT OBJ('${folder}') USER(${user ?? "name"}) DTAAUT(*X).`;
        return `${Profile} needs *WX authority on ${folder} and *X on every folder above it. A security officer can grant it with CHGAUT OBJ('${folder}') USER(${user ?? "name"}) DTAAUT(*WX).`;
      }
      if (context?.startsWith("Spooled file") || /authorized to spooled file/i.test(text)) {
        return `${Profile} is not authorized to this spooled file. Working with other users' spooled files needs *SPLCTL special authority, or *JOBCTL on an output queue created with OPRCTL(*YES).`;
      }
      const object = objectOf(text);
      if (object) {
        const kind = OBJECT_TYPES[object.type] ?? `object (${object.type})`;
        return `${Profile} is not authorized to ${kind} ${object.library}/${object.name}. A security officer can grant it, for example with GRTOBJAUT OBJ(${object.library}/${object.name}) OBJTYPE(${object.type}) USER(${user ?? "name"}) AUT(*USE).`;
      }
      const library = libraryOf(text);
      if (library) {
        return `${Profile} is not authorized to library ${library}. A security officer can grant it with GRTOBJAUT OBJ(${library}) OBJTYPE(*LIB) USER(${user ?? "name"}) AUT(*USE).`;
      }
      return `${Profile} is not authorized to ${context ? lowerFirst(context) : "an object Spooldoc needs"}. A security officer can grant it; the details name the object.`;
    }

    case "notfound": {
      if (isIfs(context)) {
        const { folder } = ifsTarget(context!);
        return `The folder ${folder} does not exist on ${system}. Create it, or change the destination's folder.`;
      }
      if (context?.startsWith("Spooled file") || /CPF3C40|CPF3344|CPF3342|no longer in the system/i.test(text)) {
        return `${context ?? "The spooled file"} is no longer on ${system}. It was deleted or printed, or its job's output was cleaned up.`;
      }
      const object = objectOf(text);
      if (object?.type === "*OUTQ") {
        return `Output queue ${object.library}/${object.name} does not exist on ${system}. If it was renamed or deleted, point the job's source at another queue.`;
      }
      if (object?.type === "*DTAQ") {
        return `Data queue ${object.library}/${object.name} does not exist on ${system}. Turn on real-time watching for the queue again to create it.`;
      }
      if (object) {
        const kind = OBJECT_TYPES[object.type] ?? `Object (${object.type})`;
        return `${upperFirst(kind)} ${object.library}/${object.name} does not exist on ${system}.`;
      }
      const library = libraryOf(text);
      if (library) {
        return `Library ${library} does not exist on ${system}. Check the name, or change the job's source if the library was renamed.`;
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

/**
 * The path of an IFS context and the folder it is in. "IFS file /x/a.pdf" is a write of a
 * file; "IFS /x" is a look at a path.
 */
function ifsTarget(context: string): { path: string; folder: string; writing: boolean } {
  const writing = context.startsWith("IFS file ");
  const path = context.slice(writing ? "IFS file ".length : "IFS ".length);
  const at = path.lastIndexOf("/");
  return { path, folder: at > 0 ? path.slice(0, at) : "/", writing };
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Converts anything thrown by the bridge into a `ConnectionError` with a code, a message
 * that says what to do (see `guidance`), the IBM i message ID and the system's own text
 * as `detail`, with every secret removed. Without guidance the message is the system's
 * text, after the context. A `ConnectionError` passes through, redacted again. The
 * original error is not attached as `cause`, since it may hold the password.
 */
export function toConnectionError(err: unknown, secrets: readonly string[], context?: string, target?: ErrorTarget): ConnectionError {
  const prefix = context ? `${context}: ` : "";
  if (err instanceof ConnectionError) {
    return new ConnectionError(err.code, redact(prefix + err.message, secrets), {
      messageId: err.messageId,
      detail: err.detail === undefined ? undefined : redact(err.detail, secrets),
    });
  }
  const full = redact(errorText(err), secrets);
  const code = classifyError(full, context);
  const messageId = messageIdOf(full);
  const own = (code === "host" && hostMessage(full)) || summarize(full);
  const advice = guidance(code, full, context, target);
  const message = advice ? `${advice}${messageId ? ` (${messageId})` : ""}` : prefix + own;
  return new ConnectionError(code, redact(message, secrets), { messageId, detail: redact(prefix + summarize(full), secrets) });
}
