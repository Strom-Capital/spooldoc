/**
 * Converts Nunjucks templates from before Carbone to Carbone tags, for the common cases:
 * `{{ doc.x }}`, `{% for %}` over a table row or another single element, `{% if %}` (with
 * `else`), the `money`, `date` and `pad` filters, and `asset('name')`. Anything it can't
 * map is left as it was, so the tag check flags its line.
 */

/** True when a template has Nunjucks syntax: `{{ }}`, `{% %}` or `{# #}`. */
export function isNunjucks(template: string): boolean {
  return /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/.test(template);
}

type Node =
  | { kind: "text"; text: string }
  | { kind: "output"; expr: string; raw: string }
  | { kind: "comment"; text: string; raw: string }
  | { kind: "statement"; raw: string }
  | { kind: "for"; variable: string; source: string; open: string; close: string; body: Node[]; raw: string }
  | { kind: "if"; condition: string; open: string; elseRaw?: string; close: string; then: Node[]; otherwise?: Node[]; raw: string };

type Token = { kind: "text"; text: string } | { kind: "output"; expr: string; raw: string } | { kind: "comment"; text: string; raw: string } | { kind: "statement"; body: string; raw: string };

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}|\{#([\s\S]*?)#\}/g;
  let last = 0;
  for (const m of template.matchAll(re)) {
    if (m.index > last) tokens.push({ kind: "text", text: template.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ kind: "output", expr: m[1].trim(), raw: m[0] });
    else if (m[2] !== undefined) tokens.push({ kind: "statement", body: m[2].trim(), raw: m[0] });
    else tokens.push({ kind: "comment", text: (m[3] ?? "").trim(), raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ kind: "text", text: template.slice(last) });
  return tokens;
}

const word = (body: string): string => /^\w+/.exec(body)?.[0] ?? "";

/** Parses tokens into nodes. An unmatched `for` or `if` is left as plain statements. */
function parse(tokens: Token[]): Node[] {
  let pos = 0;
  const rawOf = (from: number, to: number): string =>
    tokens
      .slice(from, to)
      .map((t) => (t.kind === "text" ? t.text : t.raw))
      .join("");

  function block(stop: string[]): { nodes: Node[]; end?: Token & { kind: "statement" } } {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const token = tokens[pos] as Token;
      if (token.kind === "statement" && stop.includes(word(token.body))) return { nodes, end: token };
      pos++;
      if (token.kind === "text") nodes.push({ kind: "text", text: token.text });
      else if (token.kind === "output") nodes.push({ kind: "output", expr: token.expr, raw: token.raw });
      else if (token.kind === "comment") nodes.push({ kind: "comment", text: token.text, raw: token.raw });
      else if (word(token.body) === "for") {
        const start = pos - 1;
        const m = /^for\s+(\w+)\s+in\s+([\s\S]+)$/.exec(token.body);
        const inner = block(["endfor", "else"]);
        if (inner.end && word(inner.end.body) === "endfor" && m) {
          pos++;
          nodes.push({ kind: "for", variable: m[1] as string, source: (m[2] as string).trim(), open: token.raw, close: inner.end.raw, body: inner.nodes, raw: rawOf(start, pos) });
        } else {
          // `for ... else`, a for without endfor or one this can't read: keep it as it was.
          if (inner.end) pos++;
          nodes.push({ kind: "statement", raw: rawOf(start, pos) });
        }
      } else if (word(token.body) === "if") {
        const start = pos - 1;
        const then = block(["elif", "else", "endif"]);
        let otherwise: Node[] | undefined;
        let elseRaw: string | undefined;
        let end = then.end;
        let ok = !!end && word(end.body) !== "elif";
        if (ok && end && word(end.body) === "else") {
          elseRaw = end.raw;
          pos++;
          const rest = block(["elif", "else", "endif"]);
          otherwise = rest.nodes;
          end = rest.end;
          ok = !!end && word(end.body) === "endif";
        }
        if (ok && end) {
          pos++;
          nodes.push({ kind: "if", condition: token.body.replace(/^if\s+/, "").trim(), open: token.raw, ...(elseRaw ? { elseRaw } : {}), close: end.raw, then: then.nodes, ...(otherwise ? { otherwise } : {}), raw: rawOf(start, pos) });
        } else {
          // elif, or no endif: skip to the matching endif and keep the whole block as it was.
          let depth = 1;
          while (pos < tokens.length && depth > 0) {
            const t = tokens[pos] as Token;
            if (t.kind === "statement" && word(t.body) === "if") depth++;
            if (t.kind === "statement" && word(t.body) === "endif") depth--;
            pos++;
          }
          nodes.push({ kind: "statement", raw: rawOf(start, pos) });
        }
      } else {
        nodes.push({ kind: "statement", raw: token.raw });
      }
    }
    return { nodes };
  }

  const out: Node[] = [];
  while (pos < tokens.length) {
    const { nodes, end } = block([]);
    out.push(...nodes);
    if (end) {
      // A stray endfor, endif or else.
      out.push({ kind: "statement", raw: end.raw });
      pos++;
    }
  }
  return out;
}

/** Loop variables and the Carbone path each stands for, such as `row` for `d.doc.lines[i]`. */
type Scope = Map<string, string>;

/** How names outside any loop are read. In templates: `doc`, `documents` and `sample`; in file names: fields of the document. */
interface Roots {
  resolve(name: string): string | undefined;
}

const TEMPLATE_ROOTS: Roots = { resolve: (name) => (["doc", "documents", "sample"].includes(name) ? `d.${name}` : undefined) };
const NAME_ROOTS: Roots = { resolve: (name) => (/^[A-Za-z_]\w*$/.test(name) ? `d.doc.${name}` : undefined) };

/** A Nunjucks path (`row.amount`, `doc.lines[0].item`) as a Carbone path, or undefined. */
function path(expr: string, scope: Scope, roots: Roots): string | undefined {
  const m = /^([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*|\[\d+\])*)$/.exec(expr.trim());
  if (!m) return undefined;
  const head = scope.get(m[1] as string) ?? roots.resolve(m[1] as string);
  return head ? `${head}${m[2]}` : undefined;
}

/** A Nunjucks literal as a Carbone formatter argument: `'EUR'`, `2`, or undefined. */
function literal(value: string): string | undefined {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  const m = /^(['"])(.*)\1$/s.exec(v);
  if (!m) return undefined;
  return `'${(m[2] as string).replace(/'/g, "''")}'`;
}

/** The text of a Nunjucks string literal, or undefined. */
const stringValue = (value: string): string | undefined => /^(['"])(.*)\1$/s.exec(value.trim())?.[2];

/** Splits `a | b(1, 'x') | c` at the pipes, outside parentheses and quotes. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

/** `yyyy`, `MM` and `dd` as Day.js tokens. */
const dateFormat = (format: string): string => format.replace(/yyyy/g, "YYYY").replace(/dd/g, "DD");

/** An output expression (`{{ ... }}`) as Carbone text, or undefined when it can't be mapped. */
function output(expr: string, scope: Scope, roots: Roots): string | undefined {
  const asset = /^asset\(\s*(['"])([^'"]*)\1\s*\)$/.exec(expr.trim());
  if (asset) return `{asset('${asset[2]}')}`;
  const [head = "", ...filters] = splitTop(expr, "|");
  const base = path(head, scope, roots);
  if (!base) return undefined;
  let formatters = "";
  let suffix = "";
  for (const filter of filters) {
    if (suffix) return undefined;
    const m = /^(\w+)(?:\(([\s\S]*)\))?$/.exec(filter);
    if (!m) return undefined;
    const args = m[2] !== undefined && m[2].trim() !== "" ? splitTop(m[2], ",") : [];
    switch (m[1]) {
      case "money": {
        formatters += ":formatN(2)";
        const currency = args[0];
        if (currency !== undefined) {
          const text = stringValue(currency);
          const field = text === undefined ? path(currency, scope, roots) : undefined;
          if (text === undefined && !field) return undefined;
          suffix = text !== undefined ? (text ? ` ${text}` : "") : ` {${field}}`;
        }
        break;
      }
      case "date": {
        const format = args[0] === undefined ? "dd.MM.yyyy" : stringValue(args[0]);
        if (format === undefined) return undefined;
        formatters += `:formatD('${dateFormat(format)}')`;
        break;
      }
      case "pad": {
        const width = args[0] !== undefined && /^\d+$/.test(args[0]) ? args[0] : undefined;
        const side = args[1] === undefined ? "left" : stringValue(args[1]);
        const char = args[2] === undefined ? undefined : literal(args[2]);
        if (!width || (side !== "left" && side !== "right") || (args[2] !== undefined && !char)) return undefined;
        formatters += `:${side === "right" ? "padr" : "padl"}(${width}${char ? `, ${char}` : ""})`;
        break;
      }
      case "upper":
        formatters += ":upperCase";
        break;
      case "lower":
        formatters += ":lowerCase";
        break;
      case "capitalize":
        formatters += ":lowerCase:ucFirst";
        break;
      case "title":
        formatters += ":lowerCase:ucWords";
        break;
      case "trim":
      case "escape":
      case "e":
        // Values are trimmed when extracted, and Carbone escapes them.
        break;
      default:
        return undefined;
    }
  }
  return `{${base}${formatters}}${suffix}`;
}

const NEGATE: Record<string, string> = { ifNEM: "ifEM", ifEM: "ifNEM", ifEQ: "ifNE", ifNE: "ifEQ", ifGT: "ifLTE", ifLTE: "ifGT", ifGTE: "ifLT", ifLT: "ifGTE" };
const COMPARE: Record<string, string> = { "==": "ifEQ", "!=": "ifNE", ">": "ifGT", ">=": "ifGTE", "<": "ifLT", "<=": "ifLTE" };

/** An `if` condition as a Carbone path and condition formatter, or undefined. */
function condition(text: string, scope: Scope, roots: Roots): { path: string; test: string } | undefined {
  // A list that is not empty: `x and x.length`, `x.length`, `x | length`, each with an optional `> 0`.
  const list = /^(?:(\S+)\s+and\s+)?(\S+?)(?:\.length|\s*\|\s*length)(?:\s*>\s*0)?$/.exec(text);
  if (list && (list[1] === undefined || list[1] === list[2])) {
    const p = path(list[2] as string, scope, roots);
    return p ? { path: p, test: "ifNEM" } : undefined;
  }
  const not = /^not\s+(.+)$/.exec(text);
  if (not) {
    const p = path(not[1] as string, scope, roots);
    return p ? { path: p, test: "ifEM" } : undefined;
  }
  const cmp = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(text);
  if (cmp) {
    const p = path(cmp[1] as string, scope, roots);
    const value = literal(cmp[3] as string);
    return p && value ? { path: p, test: `${COMPARE[cmp[2] as string]}(${value})` } : undefined;
  }
  const p = path(text, scope, roots);
  return p ? { path: p, test: "ifNEM" } : undefined;
}

/** The test negated, for an `else` block: `ifEQ('A')` gives `ifNE('A')`. */
function negate(test: string): string {
  const m = /^(\w+)(\(.*\))?$/.exec(test) as RegExpExecArray;
  return `${NEGATE[m[1] as string]}${m[2] ?? ""}`;
}

/** The single element a loop repeats: `<tr ...>...</tr>` gives `tr`. Undefined for anything else. */
function singleElement(html: string): string | undefined {
  const text = html.trim();
  const open = /^<([a-zA-Z][\w-]*)\b[^>]*>/.exec(text);
  if (!open) return undefined;
  const tag = (open[1] as string).toLowerCase();
  if (!new RegExp(`</${tag}\\s*>$`, "i").test(text)) return undefined;
  const opens = text.match(new RegExp(`<${tag}\\b`, "gi"))?.length ?? 0;
  const closes = text.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  if (opens !== closes) return undefined;
  // The first element must close at the very end, not earlier (two sibling elements).
  let depth = 0;
  for (const m of text.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0 && m.index + m[0].length < text.length) return undefined;
  }
  return tag;
}

function render(nodes: Node[], scope: Scope, roots: Roots): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "output":
        out += output(node.expr, scope, roots) ?? node.raw;
        break;
      case "comment":
        out += node.text.includes("--") ? node.raw : `<!-- ${node.text} -->`;
        break;
      case "statement":
        out += node.raw;
        break;
      case "for": {
        const source = path(node.source, scope, roots);
        const item = source ? `${source}[i]` : undefined;
        const body = item ? render(node.body, new Map(scope).set(node.variable, item), roots) : undefined;
        const tag = body ? singleElement(body) : undefined;
        if (!source || !body || !tag || !body.includes(`${source}[i]`)) {
          out += node.raw;
          break;
        }
        const indent = /\n([ \t]*)$/.exec(out)?.[1] ?? "";
        const end = tag === "tr" ? `<tr><td>{${source}[i+1]}</td></tr>` : `<${tag}>{${source}[i+1]}</${tag}>`;
        out += `${body.trim()}\n${indent}${end}`;
        break;
      }
      case "if": {
        const test = condition(node.condition, scope, roots);
        if (!test) {
          out += node.open + render(node.then, scope, roots) + (node.otherwise ? (node.elseRaw ?? "") + render(node.otherwise, scope, roots) : "") + node.close;
          break;
        }
        out += `{${test.path}:${test.test}:showBegin}${render(node.then, scope, roots)}{${test.path}:showEnd}`;
        if (node.otherwise) out += `{${test.path}:${negate(test.test)}:showBegin}${render(node.otherwise, scope, roots)}{${test.path}:showEnd}`;
        break;
      }
    }
  }
  return out;
}

/**
 * A Nunjucks template converted to Carbone tags. Data is `d` = `{ doc, documents, sample }`,
 * so `{{ doc.invoiceNo }}` becomes `{d.doc.invoiceNo}`. What can't be converted stays as it
 * was. A template without Nunjucks comes back unchanged.
 */
export function convertNunjucks(template: string): string {
  if (!isNunjucks(template)) return template;
  return render(parse(tokenize(template)), new Map(), TEMPLATE_ROOTS);
}

/**
 * A file name pattern from before Carbone, such as `invoice-{{ invoiceNo }}` (fields of the
 * document), as `invoice-{d.doc.invoiceNo}`. A pattern without Nunjucks comes back unchanged.
 */
export function convertNamePattern(pattern: string): string {
  if (!isNunjucks(pattern)) return pattern;
  return render(parse(tokenize(pattern)), new Map(), NAME_ROOTS);
}
