import type { ValueType } from "./definition.js";

/**
 * Parses a printed number: `1,234.50`, `1 234,50`, `1.234,50`, `-12.5`, `12.50-`.
 * A comma is the decimal separator when it is the last separator and is not followed
 * by exactly three digits with another comma before it. Returns null when not a number.
 */
export function parseNumber(text: string): number | null {
  let s = text.replace(/[\s ']/g, "");
  if (s === "") return null;
  let sign = 1;
  if (s.endsWith("-")) {
    sign = -1;
    s = s.slice(0, -1);
  } else if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) {
    const commas = s.split(",").length - 1;
    const after = s.length - lastComma - 1;
    decimal = commas === 1 && after !== 3 ? "," : null;
  } else if (lastDot >= 0) {
    const dots = s.split(".").length - 1;
    decimal = dots === 1 ? "." : null;
  }
  const thousands = decimal === "," ? "." : ",";
  let normal = s.split(thousands).join("");
  if (decimal === ",") normal = normal.replace(",", ".");
  if (decimal === null) normal = normal.replace(/[.,]/g, "");
  if (!/^\d*\.?\d*$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? sign * n : null;
}

/** Parses `YYYY-MM-DD`, `DD.MM.YYYY` or `D.M.YYYY` into an ISO date string, or null. */
export function parseDate(text: string): string | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Converts a trimmed text value to its type. `ok` is false when the text is not a valid number or date. */
export function convertValue(text: string, type: ValueType | undefined): { value: string | number | null; ok: boolean } {
  if (type === "number") {
    if (text === "") return { value: null, ok: true };
    const n = parseNumber(text);
    return n === null ? { value: text, ok: false } : { value: n, ok: true };
  }
  if (type === "date") {
    if (text === "") return { value: null, ok: true };
    const d = parseDate(text);
    return d === null ? { value: text, ok: false } : { value: d, ok: true };
  }
  return { value: text, ok: true };
}
