import type { SpooledFileAttributes } from "@spooldoc/core";

/** Values used when the system does not report an attribute. */
export const ATTRIBUTE_DEFAULTS = {
  pageWidth: 132,
  pageLength: 66,
  cpi: 10,
  lpi: 6,
} as const;

/** A number from a value that may arrive as a string (the SQL bridge returns strings). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A trimmed string, or "" for null and undefined. */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** A positive integer, or `fallback` when the value is missing, zero or negative. */
export function positiveInt(value: unknown, fallback: number): number {
  const n = toNumber(value);
  return n !== null && n > 0 ? Math.round(n) : fallback;
}

/**
 * Parses a CHRID as reported by the system into `{ charset, codePage }`.
 * Accepts a pair such as `697 273` or `697,273`, a path whose last part holds the
 * numbers (`/QSYS.LIB/697.273.CHRID`), or a lone character set number together with
 * a separate `codePage` value (jt400 reports ATTR_CHAR_ID and ATTR_CODEPAGE apart, as
 * zero-padded numbers). Special values such as `*DEVD` or `*JOBCCSID`, and a code page
 * of 0 or 65535, give null.
 */
export function parseChrid(chrid: unknown, codePage?: unknown): SpooledFileAttributes["chrid"] {
  const text = toText(chrid);
  if (text === "" || text.startsWith("*")) return null;
  const last = text.includes("/") ? (text.split("/").filter(Boolean).pop() ?? "") : text;
  const numbers = (last.match(/\d+/g) ?? []).map(Number);
  let charset: number | undefined;
  let page: number | undefined;
  if (numbers.length >= 2) {
    [charset, page] = numbers;
  } else if (numbers.length === 1) {
    charset = numbers[0];
    const cp = toNumber(typeof codePage === "string" && codePage.trim().startsWith("*") ? null : codePage);
    page = cp ?? undefined;
  }
  if (charset === undefined || page === undefined) return null;
  if (page === 0 || page === 65535) return null;
  return { charset, codePage: page };
}

/** Splits an IFS output queue path such as `/QSYS.LIB/MYLIB.LIB/INVOICES.OUTQ`. Returns null for anything else. */
export function parseOutqPath(path: unknown): { library: string; name: string } | null {
  const text = toText(path).toUpperCase();
  let m = /^\/QSYS\.LIB\/([^/]+)\.LIB\/([^/]+)\.OUTQ$/.exec(text);
  if (m) return { library: m[1] ?? "", name: m[2] ?? "" };
  m = /^\/QSYS\.LIB\/([^/]+)\.OUTQ$/.exec(text);
  if (m) return { library: "QSYS", name: m[1] ?? "" };
  return null;
}

/** Splits a qualified job name `number/user/name`. */
export function splitJobName(qualified: unknown): { jobNumber: string; jobUser: string; jobName: string } {
  const parts = toText(qualified).split("/");
  if (parts.length !== 3) return { jobNumber: "", jobUser: "", jobName: toText(qualified) };
  const [jobNumber = "", jobUser = "", jobName = ""] = parts.map((p) => p.trim());
  return { jobNumber, jobUser, jobName };
}

/**
 * The creation time from the jt400 ATTR_DATE (`CYYMMDD`) and ATTR_TIME (`HHMMSS`) values,
 * as `YYYY-MM-DDTHH:MM:SS` local system time. Returns "" when the date is not in that form.
 */
export function spoolDateTime(date: unknown, time: unknown): string {
  const d = toText(date);
  if (!/^\d{7}$/.test(d)) return "";
  const t = toText(time).padStart(6, "0");
  const hms = /^\d{6}$/.test(t) ? t : "000000";
  const year = 1900 + Number(d.slice(0, 3));
  return `${year}-${d.slice(3, 5)}-${d.slice(5, 7)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
}

/** An SQL timestamp such as `2026-10-17 21:40:38.254885` as `2026-10-17T21:40:38`. Other text is returned trimmed. */
export function sqlTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  const text = toText(value);
  const m = /^(\d{4}-\d{2}-\d{2})[ T-](\d{2})[:.](\d{2})[:.](\d{2})/.exec(text);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}` : text;
}
