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

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    let cause: unknown = (err as { cause?: unknown }).cause;
    for (let i = 0; i < 4 && cause; i++) {
      parts.push(cause instanceof Error ? cause.message : typeof cause === "object" ? "" : String(cause));
      cause = cause instanceof Error ? (cause as { cause?: unknown }).cause : undefined;
    }
    return parts.filter(Boolean).join("\n");
  }
  return String(err);
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
  return new ConnectionError(classifyError(full), redact(prefix + summarize(full), secrets));
}
