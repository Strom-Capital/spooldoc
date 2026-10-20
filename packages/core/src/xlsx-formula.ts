/**
 * Excel's newer functions in formulas. A file stores them with a prefix, such as
 * `_xlfn.XLOOKUP`; without it LibreOffice, and so Carbone, computes `#NAME?`. Excel adds
 * the prefix itself when it saves, but a formula written into the XML needs it written.
 */

/** The newer functions LibreOffice computes, with the prefix each needs in the file. Tried against Carbone 5.15.5. */
export const FUNCTION_PREFIXES: Readonly<Record<string, string>> = {
  XLOOKUP: "_xlfn.",
  XMATCH: "_xlfn.",
  IFS: "_xlfn.",
  SWITCH: "_xlfn.",
  TEXTJOIN: "_xlfn.",
  CONCAT: "_xlfn.",
  MAXIFS: "_xlfn.",
  MINIFS: "_xlfn.",
  IFNA: "_xlfn.",
  UNIQUE: "_xlfn.",
  FILTER: "_xlfn._xlws.",
  SORT: "_xlfn._xlws.",
};

/** A function call in a formula: its name, with any prefix, before `(`. */
const CALL = /((?:_xlfn\.|_xlws\.)*)([A-Za-z][A-Za-z0-9.]*)\s*\(/gy;

/** One function call outside string literals and quoted sheet names: where its prefix starts, the prefix as written and the name. */
interface Call {
  start: number;
  prefix: string;
  name: string;
}

/** The function calls of a formula, skipping `"text"` and `'Sheet name'`. */
function calls(formula: string): Call[] {
  const out: Call[] = [];
  for (let at = 0; at < formula.length; ) {
    const c = formula[at]!;
    if (c === '"' || c === "'") {
      // `""` and `''` are an escaped quote inside.
      let end = at + 1;
      for (; end < formula.length; end++) {
        if (formula[end] === c) {
          if (formula[end + 1] === c) end++;
          else break;
        }
      }
      at = end + 1;
      continue;
    }
    // A name starts after something that is not part of a name.
    if (/[A-Za-z_]/.test(c) && (at === 0 || !/[A-Za-z0-9_.$]/.test(formula[at - 1]!))) {
      CALL.lastIndex = at;
      const m = CALL.exec(formula);
      if (m) {
        out.push({ start: at, prefix: m[1]!, name: m[2]! });
        at = CALL.lastIndex;
        continue;
      }
      let end = at + 1;
      while (end < formula.length && /[A-Za-z0-9_.$!]/.test(formula[end]!)) end++;
      at = end;
      continue;
    }
    at++;
  }
  return out;
}

/**
 * The formula with the prefix each newer function needs, outside string literals and
 * quoted sheet names. A prefix already there is kept when right and corrected when
 * wrong, never doubled.
 */
export function withFunctionPrefixes(formula: string): string {
  let out = "";
  let from = 0;
  for (const call of calls(formula)) {
    const wanted = FUNCTION_PREFIXES[call.name.toUpperCase()];
    if (wanted === undefined || call.prefix === wanted) continue;
    out += formula.slice(from, call.start) + wanted + call.name.toUpperCase();
    from = call.start + call.prefix.length + call.name.length;
  }
  return out + formula.slice(from);
}

/** The newer functions in a formula written without the prefix they need, such as `XLOOKUP` for `_xlfn.XLOOKUP`, each once. */
export function missingPrefixes(formula: string): { name: string; prefixed: string }[] {
  const out: { name: string; prefixed: string }[] = [];
  for (const call of calls(formula)) {
    const name = call.name.toUpperCase();
    const wanted = FUNCTION_PREFIXES[name];
    if (wanted === undefined || call.prefix === wanted || out.some((m) => m.name === name)) continue;
    out.push({ name, prefixed: wanted + name });
  }
  return out;
}
