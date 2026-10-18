import { ConnectionError, type ConnectionErrorCode } from "./connection.js";

const RULES: [ConnectionErrorCode, RegExp][] = [
  [
    "auth",
    /AS400SecurityException|password (is )?(not correct|incorrect|expired|not set)|user (id|profile) (is )?(not known|disabled|does not exist)|profile .*disabled|CPF22E[2-5]|CPF2204|SQL30082|\b08004\b/i,
  ],
  [
    "host",
    /UnknownHostException|nodename nor servname|Name or service not known|ConnectException|Connection refused|NoRouteToHost|SocketTimeoutException|timed out|cannot establish the connection|\b08001\b/i,
  ],
  ["authority", /CPF3401|CPF2189|CPF2182|CPF2207|CPF3C52|not authorized|SQL0551|SQL0552/i],
  ["notfound", /CPF3C40|CPF3344|CPF3342|CPF3330|CPF2105|CPF2110|ObjectDoesNotExistException|not found|does not exist|no longer in the system|SQL0204/i],
];

/** Classifies an error text into a `ConnectionError` code. */
export function classifyError(text: string): ConnectionErrorCode {
  for (const [code, re] of RULES) if (re.test(text)) return code;
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
 * ibmi.example.com: unknown host", from the Java exception text. The host comes from
 * an `UnknownHostException` or from the JDBC driver's "(host)" detail; without one
 * the message names "the system". Undefined when no reason is recognized.
 */
export function hostMessage(text: string): string | undefined {
  const reason = HOST_REASONS.find(([, re]) => re.test(text))?.[0];
  if (!reason) return undefined;
  const host =
    /UnknownHostException:\s*([^\s:]+)/.exec(text)?.[1] ??
    /cannot establish the connection\. \(([^()\s]+)\)/i.exec(text)?.[1] ??
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
    const m = /^(?:Caused by: )?(?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error):\s*(.+)$/.exec(line);
    if (m?.[1]) best = m[1];
  }
  const out = best || lines[0] || "Unknown error";
  return out.length > 500 ? `${out.slice(0, 497)}...` : out;
}

/**
 * Converts anything thrown by the bridge into a `ConnectionError` with a code and a
 * short message, with every secret removed. A `ConnectionError` passes through
 * (its message is redacted again). The original error is not attached as `cause`,
 * since it may hold the password.
 */
export function toConnectionError(err: unknown, secrets: readonly string[], context?: string): ConnectionError {
  const prefix = context ? `${context}: ` : "";
  if (err instanceof ConnectionError) return new ConnectionError(err.code, redact(prefix + err.message, secrets));
  const full = redact(errorText(err), secrets);
  const code = classifyError(full);
  const message = (code === "host" && hostMessage(full)) || summarize(full);
  return new ConnectionError(code, redact(prefix + message, secrets));
}
