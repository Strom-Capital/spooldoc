/**
 * Excel's newer functions in formulas. A file stores them with a prefix, such as
 * `_xlfn.XLOOKUP`; without it LibreOffice, and so Carbone, computes `#NAME?`. Excel adds
 * the prefix itself when it saves, and so does hucre when it writes a design, but a
 * formula written into the XML by hand needs it written. The tag check names the ones
 * that miss it.
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

/** One function call outside string literals and quoted sheet names: the prefix as written and the name. */
interface Call {
  prefix: string;
  name: string;
}

const PREFIXES = ["_xlfn.", "_xlws."];
const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);
const isNamePart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9.]/.test(c);

/**
 * The function calls of a formula, skipping `"text"` and `'Sheet name'`. One pass, by
 * hand rather than with a regular expression, so a long formula costs linear time.
 */
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
      let pos = at;
      let prefix = "";
      for (let found = true; found; ) {
        found = false;
        for (const p of PREFIXES) {
          if (formula.startsWith(p, pos)) {
            prefix += p;
            pos += p.length;
            found = true;
          }
        }
      }
      let end = pos;
      if (isLetter(formula[end])) while (isNamePart(formula[end])) end++;
      let after = end;
      while (formula[after] === " " || formula[after] === "\t" || formula[after] === "\n" || formula[after] === "\r") after++;
      if (end > pos && formula[after] === "(") {
        out.push({ prefix, name: formula.slice(pos, end) });
        at = after + 1;
        continue;
      }
      // Not a call: skip the rest of the name, such as a cell or a sheet reference.
      let skip = Math.max(end, at + 1);
      while (skip < formula.length && /[A-Za-z0-9_.$!]/.test(formula[skip]!)) skip++;
      at = skip;
      continue;
    }
    at++;
  }
  return out;
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
