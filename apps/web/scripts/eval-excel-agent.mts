/**
 * Measures how the agent designs and edits Excel templates (issue #81). Each case gives
 * the agent a fresh in-memory draft with the invoice definition of the core fixtures and
 * one Excel template, sends one user message, runs the agent with the app's own
 * instructions and tools until it stops, and scores the template's latest file, rendered
 * with Carbone.
 *
 *   SPOOLDOC_CARBONE_URL=http://localhost:4000 ANTHROPIC_API_KEY=... \
 *     pnpm --filter @spooldoc/web eval:excel --model anthropic:claude-sonnet-5-5
 *
 * Options:
 *   --model <provider:id>    The model, such as anthropic:claude-sonnet-5-5. Its key comes
 *                            from the provider's usual variable, such as ANTHROPIC_API_KEY.
 *   --effort <level>         The reasoning level, as in Settings. Default provider-default.
 *   --baseline-skill <path>  Use the text of this file in place of Spooldoc's design
 *                            guidance. The text is read at run time and never written out.
 *   --only <case>            Run one case: lines, summary, page-group or edit.
 *   --steps <n>              Most model steps per case. Default 20.
 *   --out <file.md>          Also write the report to this file.
 *   --dry-run                Score each case's starting file without a model, to check the
 *                            scoring and the Carbone connection.
 *
 * It runs with tsx and the `react-server` condition, so the app's `server-only` guard
 * lets the server modules load outside Next. It needs no database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  buildXlsx,
  carboneStatus,
  checkXlsx,
  extract,
  parseDefinition,
  probeEdition,
  readXlsx,
  readXlsxValues,
  renderDocument,
  sampleSchema,
  spooledFileData,
  starterLayout,
  starterXlsx,
  templateData,
  type CarboneServer,
  type Definition,
  type Sample,
  type ValueType,
  type XlsxScope,
  type XlsxValue,
} from '@spooldoc/core';
import { generateText, isStepCount, type ModelMessage } from 'ai';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { AI_PROVIDER_IDS, EFFORT_IDS, type AiProviderId, type Effort } from '@/lib/ai-providers';
import type { JobTemplate } from '@/lib/job-spec';
import { ASK_USER_TOOL, askedUser, buildInstructions, buildTools, fileTemplates } from '@/lib/server/chat';
import type { DocumentRenderer } from '@/lib/server/documents';
import { languageModel, takesFiles } from '@/lib/server/models';
import { MemoryDraft } from '@/tests/helpers/memory-draft';

// --- Arguments --------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    model: { type: 'string' },
    effort: { type: 'string', default: 'provider-default' },
    'baseline-skill': { type: 'string' },
    only: { type: 'string' },
    steps: { type: 'string', default: '20' },
    out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function stop(text: string): never {
  console.error(text);
  process.exit(1);
}

/** The variable each provider reads its key from. */
const KEY_VARS: Record<AiProviderId, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gateway: 'AI_GATEWAY_API_KEY',
  local: null,
};

const dryRun = args['dry-run'] ?? false;
const carboneUrl = process.env.SPOOLDOC_CARBONE_URL;
if (!carboneUrl) stop('Set SPOOLDOC_CARBONE_URL to a Carbone server, such as http://localhost:4000.');
const maxSteps = Number(args.steps);
if (!Number.isInteger(maxSteps) || maxSteps < 1) stop('--steps takes a whole number of at least 1.');
const effort = args.effort as Effort;
if (!(EFFORT_IDS as readonly string[]).includes(effort)) stop(`--effort takes one of: ${EFFORT_IDS.join(', ')}.`);

let provider: AiProviderId = 'anthropic';
let modelId = '';
if (!dryRun) {
  const spec = args.model ?? stop('Give the model with --model <provider:id>, such as anthropic:claude-sonnet-5-5, or use --dry-run.');
  const at = spec.indexOf(':');
  const name = spec.slice(0, at);
  if (at < 1 || !(AI_PROVIDER_IDS as readonly string[]).includes(name)) stop(`--model starts with a provider: ${AI_PROVIDER_IDS.join(', ')}.`);
  provider = name as AiProviderId;
  modelId = spec.slice(at + 1);
  const keyVar = KEY_VARS[provider];
  if (keyVar && !process.env[keyVar]) stop(`Set ${keyVar} for the ${provider} provider.`);
  if (provider === 'local' && !process.env.SPOOLDOC_LOCAL_BASE_URL) stop('Set SPOOLDOC_LOCAL_BASE_URL for the local provider.');
}
// The text stays in memory: it goes into the instructions and nowhere else.
const baseline = args['baseline-skill'] ? readFileSync(args['baseline-skill'], 'utf8') : undefined;

// --- Fixtures ---------------------------------------------------------------------------

const fixture = (file: string): string => readFileSync(new URL(`../../../packages/core/fixtures/invoice/${file}`, import.meta.url), 'utf8');
const yaml = fixture('definition.yaml');
const def: Definition = parseDefinition(yaml);
const sample: Sample = sampleSchema.parse(JSON.parse(fixture('sample.json')));
const pageGroups = extract(def, sample).pageGroups;

/** The look of the user's own workbook: a font and colours of its own, so the edit can be checked for them. */
const USER_FONT = 'Georgia';
const ACCENT = '7A3E48';
const HEADER_FILL = 'F3E9DC';

/**
 * A workbook "the user made" in Excel: one sheet of invoice lines of the whole spooled
 * file in Georgia 11, a coloured title and header, and a bar chart of the amounts. The
 * chart is added as Excel writes one (chart, drawing, their relationships and content
 * types), so the edit can be checked for leaving it as it was.
 */
async function userWorkbook(): Promise<Uint8Array> {
  const header = (ref: string, value: string, right = false) => ({
    ref,
    value,
    style: {
      font: { bold: true, color: ACCENT },
      fill: { type: 'pattern', pattern: 'solid', fgColor: HEADER_FILL },
      border: { bottom: { style: 'medium', color: ACCENT } },
      ...(right ? { alignment: { horizontal: 'right' } } : {}),
    },
  });
  const design = {
    defaultFont: { name: USER_FONT, size: 11, color: '2B2B2B' },
    sheets: [
      {
        name: 'Invoice lines',
        tabColor: ACCENT,
        views: { frozen: { rows: 2 } },
        columns: [
          { ref: 'A', width: 11 },
          { ref: 'B', width: 13 },
          { ref: 'C', width: 26 },
          { ref: 'D', width: 11 },
          { ref: 'E', width: 30 },
          { ref: 'F', width: 8 },
          { ref: 'G', width: 12 },
          { ref: 'H', width: 13 },
        ],
        cells: [
          { ref: 'A1', value: 'Invoice lines', style: { font: { bold: true, size: 14, color: 'FFFFFF' }, fill: { type: 'pattern', pattern: 'solid', fgColor: ACCENT } } },
          header('A2', 'Invoice'),
          header('B2', 'Date'),
          header('C2', 'Customer'),
          header('D2', 'Item'),
          header('E2', 'Description'),
          header('F2', 'Qty', true),
          header('G2', 'Unit price', true),
          header('H2', 'Amount (EUR)', true),
          { ref: 'A3', value: '{d.pgs[i].invoiceNo}' },
          { ref: 'B3', value: '{d.pgs[i].invoiceDate:formatD(X):div(86400):add(25569):formatN}', style: { numFmt: 'd mmm yyyy' } },
          { ref: 'C3', value: '{d.pgs[i].customerName}' },
          { ref: 'D3', value: '{d.pgs[i].lines[i].item}' },
          { ref: 'E3', value: '{d.pgs[i].lines[i].description}' },
          { ref: 'F3', value: '{d.pgs[i].lines[i].quantity:formatN}', style: { numFmt: '0' } },
          { ref: 'G3', value: '{d.pgs[i].lines[i].unitPrice:formatN}', style: { numFmt: '#,##0.00' } },
          { ref: 'H3', value: '{d.pgs[i].lines[i].amount:formatN}', style: { numFmt: '#,##0.00' } },
          { ref: 'A4', value: '{d.pgs[i+1].lines[i+1]}' },
        ],
        autoFilter: 'A2:H5000',
        pageSetup: { paperSize: 'A4', orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, printTitlesRow: '2:2' },
        headerFooter: { oddFooter: '&L&A&RPage &P of &N' },
      },
    ],
  };
  return withChart(await buildXlsx(design));
}

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="${USER_FONT}"/></a:rPr><a:t>Amount by item</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Amount</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${ACCENT}"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>'Invoice lines'!$D$3:$D$3</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'Invoice lines'!$H$3:$H$3</c:f></c:numRef></c:val></c:ser><c:axId val="5001"/><c:axId val="5002"/></c:barChart><c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="5002"/></c:catAx><c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="5001"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>15</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** The workbook with a chart of the amounts on its first sheet. */
function withChart(xlsx: Uint8Array): Uint8Array {
  const files = unzipSync(xlsx);
  const text = (name: string): string => strFromU8(files[name] ?? stop(`The fixture workbook has no ${name}.`));
  files['xl/charts/chart1.xml'] = strToU8(CHART_XML);
  files['xl/drawings/drawing1.xml'] = strToU8(DRAWING_XML);
  files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_RELS}"><Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  const relsName = 'xl/worksheets/_rels/sheet1.xml.rels';
  const rels = files[relsName] ? strFromU8(files[relsName]) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_RELS}"></Relationships>`;
  const drawingId = 'rIdChart1';
  files[relsName] = strToU8(rels.replace('</Relationships>', `<Relationship Id="${drawingId}" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
  const sheet = text('xl/worksheets/sheet1.xml');
  // A drawing comes after the page setup and before any legacy drawing, tables or extensions.
  const before = ['<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'].map((tag) => sheet.indexOf(tag)).filter((at) => at !== -1);
  const at = Math.min(...before);
  files['xl/worksheets/sheet1.xml'] = strToU8(`${sheet.slice(0, at)}<drawing r:id="${drawingId}"/>${sheet.slice(at)}`);
  const types = text('[Content_Types].xml');
  files['[Content_Types].xml'] = strToU8(
    types.replace(
      '</Types>',
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
    ),
  );
  if (!/xmlns:r=/.test(sheet.slice(0, sheet.indexOf('>', sheet.indexOf('<worksheet'))))) {
    files['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(files['xl/worksheets/sheet1.xml']!).replace('<worksheet ', `<worksheet xmlns:r="${REL}" `));
  }
  return zipSync(files);
}

// --- Cases ------------------------------------------------------------------------------

interface Case {
  id: string;
  prompt: string;
  scope: XlsxScope;
  /** The file the template starts with; the starter when not given. */
  file?: () => Promise<{ name: string; content: Uint8Array }>;
}

const CASES: Case[] = [
  { id: 'lines', prompt: 'An invoice lines sheet people can filter and sum.', scope: 'splf' },
  { id: 'summary', prompt: 'A summary per customer with totals, and the lines on a second sheet.', scope: 'splf' },
  { id: 'page-group', prompt: 'A page group sheet per invoice that prints on one A4 page.', scope: 'pageGroup' },
  {
    id: 'edit',
    prompt: 'Edit this file the user made: add a VAT column (24 %) and a total.',
    scope: 'splf',
    file: async () => ({ name: 'invoice-lines.xlsx', content: await userWorkbook() }),
  },
];

const cases = args.only ? CASES.filter((c) => c.id === args.only) : CASES;
if (cases.length === 0) stop(`--only takes one of: ${CASES.map((c) => c.id).join(', ')}.`);

// --- Carbone ----------------------------------------------------------------------------

const server: CarboneServer = { url: carboneUrl, timeoutMs: 120_000 };
const renderer: DocumentRenderer = (input) => renderDocument(server, input);

/** The data of the document the scores are made from: the whole spooled file, or the first page group. */
const dataFor = (bytes: Uint8Array, scope: XlsxScope) =>
  scope === 'splf' ? spooledFileData(pageGroups, sample) : templateData(readXlsx(bytes), pageGroups[0]!, pageGroups, sample);

// --- Scores -----------------------------------------------------------------------------

interface Scores {
  problems: string[];
  errorCells: string[];
  totals: { right: number; checked: number; wrong: string[] };
  typed: { numbers: number; checked: number; wrong: string[] };
  pageSetup: { ok: number; sheets: number; notes: string[] };
  pdf: { a4: boolean; pages: number | null; sizes: string[] } | null;
  edit?: { changed: string[]; lostFonts: number; lostFills: number; newCells: number; otherFont: string[] };
  renderError?: string;
}

const columnNumber = (letters: string): number => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = (ref: string): { column: number; row: number } => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref) ?? stop(`Not a cell: ${ref}`);
  return { column: columnNumber(m[1]!), row: Number(m[2]) };
};
const unquote = (sheet: string | undefined): string | undefined => (sheet === undefined ? undefined : sheet.replace(/^'(.*)'$/, '$1').replace(/''/g, "'"));
const cellName = (sheet: string, ref: string): string => `${/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? sheet : `'${sheet}'`}!${ref}`;

const SHEET = String.raw`(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?`;
const SUM_OF = /^\s*=?\s*(?:SUM\(|SUBTOTAL\(\s*(?:9|109)\s*,\s*)(.+)\)\s*$/i;
const RANGE = new RegExp(String.raw`^${SHEET}\$?([A-Z]{1,3})\$?(\d*):\$?([A-Z]{1,3})\$?(\d*)$`, 'i');
const INDIRECT = new RegExp(String.raw`^INDIRECT\(\s*"${SHEET}\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?"\s*&\s*\(?\s*ROW\(\)\s*-\s*(\d+)\s*\)?\s*\)$`, 'i');

/** The range a SUM or SUBTOTAL total adds up, or undefined for any other formula. */
function sumRange(formula: string, sheet: string, row: number): { sheet: string; top: number; left: number; bottom: number; right: number } | undefined {
  const arg = SUM_OF.exec(formula)?.[1]?.trim();
  if (!arg) return undefined;
  const range = RANGE.exec(arg);
  if (range) {
    return {
      sheet: unquote(range[1]) ?? sheet,
      left: columnNumber(range[2]!),
      top: range[3] ? Number(range[3]) : 1,
      right: columnNumber(range[4]!),
      bottom: range[5] ? Number(range[5]) : 1_048_576,
    };
  }
  const indirect = INDIRECT.exec(arg);
  if (indirect) {
    return { sheet: unquote(indirect[1]) ?? sheet, left: columnNumber(indirect[2]!), top: Number(indirect[3]), right: columnNumber(indirect[4]!), bottom: row - Number(indirect[5]) };
  }
  return undefined;
}

/** SUM and SUBTOTAL totals checked against the numbers in their range, as computed. */
function scoreTotals(values: XlsxValue[]): Scores['totals'] {
  const out: Scores['totals'] = { right: 0, checked: 0, wrong: [] };
  for (const cell of values) {
    if (!cell.formula) continue;
    const at = splitRef(cell.ref);
    const range = sumRange(cell.formula, cell.sheet, at.row);
    if (!range) continue;
    out.checked++;
    let expected = 0;
    let numbers = 0;
    for (const other of values) {
      if (other.sheet !== range.sheet || other === cell || other.type !== 'n' || typeof other.value !== 'number') continue;
      const o = splitRef(other.ref);
      if (o.row >= range.top && o.row <= range.bottom && o.column >= range.left && o.column <= range.right) {
        expected += other.value;
        numbers++;
      }
    }
    // A total over a range with no numbers in it adds up nothing, even when it shows 0.
    if (numbers > 0 && typeof cell.value === 'number' && Math.abs(cell.value - expected) <= 0.005) out.right++;
    else
      out.wrong.push(
        `${cellName(cell.sheet, cell.ref)} =${cell.formula} is ${String(cell.value)}, ${numbers === 0 ? 'and its range holds no numbers' : `the ${numbers} numbers in its range add up to ${expected.toFixed(2)}`}`,
      );
  }
  return out;
}

/** The types of the definition's fields and columns, by path without indexes: `invoiceDate`, `lines.amount`. */
function fieldTypes(): Map<string, ValueType> {
  const { fields, blocks } = starterLayout(def);
  const types = new Map<string, ValueType>();
  for (const f of fields) if (f.type) types.set(f.name, f.type);
  for (const b of blocks) for (const c of b.columns) if (c.type) types.set(`${b.name}.${c.name}`, c.type);
  return types;
}

/** How many rows a loop tag such as `d.pgs[i].lines[i].amount` makes from the data. */
function loopRows(data: unknown, path: string): number {
  const parts = path.replace(/^d\./, '').split('.');
  const count = (value: unknown, rest: string[]): number => {
    const loop = rest.findIndex((part) => /\[i\]$/.test(part));
    if (loop === -1) return 1;
    let at = value;
    for (const part of rest.slice(0, loop + 1)) {
      const name = part.replace(/\[i\]$/, '');
      at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[name] : undefined;
    }
    return Array.isArray(at) ? at.reduce<number>((sum, item) => sum + count(item, rest.slice(loop + 1)), 0) : 0;
  };
  return count(data, parts);
}

/**
 * Number and date fields as number cells: each template cell that is one tag of a number
 * or date field is found in the rendered sheet (its rows, for a loop, and moved down by
 * the loops above it) and must be `t="n"`.
 */
function scoreTypes(bytes: Uint8Array, data: unknown, values: XlsxValue[]): Scores['typed'] {
  const types = fieldTypes();
  const template = readXlsx(bytes);
  const out: Scores['typed'] = { numbers: 0, checked: 0, wrong: [] };
  const tagPath = (text: string): string | undefined => /^\{\s*(d\.[\w.[\]+\s]+?)\s*(?::[^{}]*)?\}$/.exec(text.trim())?.[1]?.replace(/\s/g, '');
  // The loops of each sheet: their row and how many rows they make, from the deepest loop in the row.
  const loops = new Map<string, { row: number; rows: number }[]>();
  for (const cell of template.cells) {
    const path = /\{\s*(d\.[^:}]*\[i\][^:}]*)/.exec(cell.text)?.[1]?.replace(/\s/g, '');
    if (!path || /\[i\+1\]/.test(cell.text)) continue;
    const list = loops.get(cell.sheet) ?? [];
    const rows = loopRows(data, path);
    const loop = list.find((l) => l.row === cell.row);
    if (loop) loop.rows = Math.max(loop.rows, rows);
    else list.push({ row: cell.row, rows });
    loops.set(cell.sheet, list);
  }
  const rendered = new Map(values.map((v) => [`${v.sheet}!${v.ref}`, v]));
  for (const cell of template.cells) {
    const path = tagPath(cell.text);
    if (!path) continue;
    const field = path.replace(/^d\.(?:pg|pgs\[[^\]]*\])\./, '').replace(/\[[^\]]*\]/g, '');
    const type = types.get(field);
    if (type !== 'number' && type !== 'date') continue;
    const letters = cell.ref.replace(/\d+$/, '');
    const sheetLoops = loops.get(cell.sheet) ?? [];
    const shift = sheetLoops.filter((loop) => loop.row < cell.row).reduce((sum, loop) => sum + loop.rows - 2, 0);
    const own = sheetLoops.find((loop) => loop.row === cell.row);
    const first = cell.row + shift;
    const rows = own ? own.rows : 1;
    for (let row = first; row < first + rows; row++) {
      const value = rendered.get(`${cell.sheet}!${letters}${row}`);
      if (!value) continue;
      out.checked++;
      if (value.type === 'n') out.numbers++;
      else out.wrong.push(`${cellName(cell.sheet, `${letters}${row}`)} is ${value.type} ${JSON.stringify(value.value)} (${cell.text})`);
    }
  }
  return out;
}

/** The sheets of a workbook in order, with their part names. */
function sheetParts(files: Record<string, Uint8Array>): { name: string; part: string; index: number }[] {
  const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m, index) => {
    const name = /name="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const target = targets.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? '';
    const part = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    // One pass, so `&amp;apos;` stays `&apos;`.
    return { name: name.replace(/&(amp|apos);/g, (_, entity: string) => (entity === 'amp' ? '&' : "'")), part, index };
  });
}

/** Every sheet with a page setup, fitted to one page wide, with print titles. */
function scorePageSetup(bytes: Uint8Array): Scores['pageSetup'] {
  const files = unzipSync(bytes);
  const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const titles = new Set([...workbook.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)].filter((m) => /name="_xlnm\.Print_Titles"/.test(m[1]!)).map((m) => /localSheetId="(\d+)"/.exec(m[1]!)?.[1]));
  const sheets = sheetParts(files);
  const out: Scores['pageSetup'] = { ok: 0, sheets: sheets.length, notes: [] };
  for (const sheet of sheets) {
    const xml = strFromU8(files[sheet.part] ?? new Uint8Array());
    const setup = /<pageSetup\b[^>]*>/.exec(xml)?.[0];
    const fitToPage = /<pageSetUpPr\b[^>]*fitToPage="(1|true)"/.test(xml);
    const wide = setup ? (/fitToWidth="(\d+)"/.exec(setup)?.[1] ?? '1') : undefined;
    const missing = [
      setup ? '' : 'no page setup',
      setup && /paperSize="(\d+)"/.exec(setup)?.[1] !== '9' ? 'paper is not A4' : '',
      setup && !(fitToPage && wide === '1') ? 'not fitted to one page wide' : '',
      titles.has(String(sheet.index)) ? '' : 'no print titles',
    ].filter(Boolean);
    if (missing.length === 0) out.ok++;
    else out.notes.push(`${sheet.name}: ${missing.join(', ')}`);
  }
  return out;
}

/** Width and height in points of each page of a PDF, from its MediaBox entries. */
function pageSizes(pdf: Uint8Array): [number, number][] {
  const text = Buffer.from(pdf).toString('latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])]);
}

const isA4 = ([w, h]: [number, number]): boolean => {
  const [short, long] = w < h ? [w, h] : [h, w];
  return Math.abs(short - 595.3) < 2 && Math.abs(long - 841.9) < 2;
};

/** The entries an edit may change: sheets, styles, the workbook, strings, the calculation chain, content types and relationships. */
const EDITABLE = /^(xl\/worksheets\/[^/]+\.xml|xl\/styles\.xml|xl\/workbook\.xml|xl\/sharedStrings\.xml|xl\/calcChain\.xml|\[Content_Types\]\.xml|.*\.rels)$/;

/** The entries of one list of `styles.xml`, such as every `<font>`, without the space between tags. */
function styleEntries(styles: string, list: 'fonts' | 'fills', entry: 'font' | 'fill'): string[] {
  const body = new RegExp(`<${list}\\b[^>]*>([\\s\\S]*?)</${list}>`).exec(styles)?.[1] ?? '';
  return [...body.matchAll(new RegExp(`<${entry}\\b[^>]*/>|<${entry}\\b[^>]*>[\\s\\S]*?</${entry}>`, 'g'))].map((m) => m[0].replace(/>\s+</g, '><'));
}

/** The font name of each cell format in `cellXfs`. */
function xfFonts(styles: string): string[] {
  const fonts = styleEntries(styles, 'fonts', 'font').map((font) => /<name val="([^"]*)"/.exec(font)?.[1] ?? '');
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => fonts[Number(/fontId="(\d+)"/.exec(m[0])?.[1] ?? 0)] ?? '');
}

/** The cells of each sheet with their cell format, by `Sheet!A1`. */
function sheetCells(files: Record<string, Uint8Array>): Map<string, number> {
  const out = new Map<string, number>();
  for (const sheet of sheetParts(files)) {
    const xml = strFromU8(files[sheet.part] ?? new Uint8Array());
    for (const m of xml.matchAll(/<c\b([^>]*?)\/?>/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(m[1]!)?.[1];
      if (ref) out.set(`${sheet.name}!${ref}`, Number(/\bs="(\d+)"/.exec(m[1]!)?.[1] ?? 0));
    }
  }
  return out;
}

/** What an edit kept of the user's file: the entries it may not change, the fonts and fills, and the font of the new cells. */
function scoreEdit(before: Uint8Array, after: Uint8Array): NonNullable<Scores['edit']> {
  const a = unzipSync(before);
  const b = unzipSync(after);
  const changed = Object.keys(a)
    .filter((name) => !EDITABLE.test(name))
    .filter((name) => !b[name] || Buffer.compare(Buffer.from(a[name]!), Buffer.from(b[name]!)) !== 0)
    .map((name) => (b[name] ? `${name} changed` : `${name} removed`));
  const stylesA = strFromU8(a['xl/styles.xml'] ?? new Uint8Array());
  const stylesB = strFromU8(b['xl/styles.xml'] ?? new Uint8Array());
  const fontsB = new Set(styleEntries(stylesB, 'fonts', 'font'));
  const fillsB = new Set(styleEntries(stylesB, 'fills', 'fill'));
  const lostFonts = styleEntries(stylesA, 'fonts', 'font').filter((f) => !fontsB.has(f)).length;
  const lostFills = styleEntries(stylesA, 'fills', 'fill').filter((f) => !fillsB.has(f)).length;
  const oldCells = sheetCells(a);
  const fonts = xfFonts(stylesB);
  const otherFont: string[] = [];
  let newCells = 0;
  for (const [ref, xf] of sheetCells(b)) {
    if (oldCells.has(ref)) continue;
    newCells++;
    const font = fonts[xf] ?? '';
    if (font !== USER_FONT) otherFont.push(`${ref} (${font || 'no font'})`);
  }
  return { changed, lostFonts, lostFills, newCells, otherFont };
}

/** Every score of a template file, from the file and its renders. */
async function score(bytes: Uint8Array, scope: XlsxScope, input?: Uint8Array): Promise<Scores> {
  const template = readXlsx(bytes);
  const problems = checkXlsx(template, def, scope).map((p) => `${cellName(p.sheet, p.ref)}: ${p.message}`);
  const scores: Scores = {
    problems,
    errorCells: [],
    totals: { right: 0, checked: 0, wrong: [] },
    typed: { numbers: 0, checked: 0, wrong: [] },
    pageSetup: scorePageSetup(bytes),
    pdf: null,
    ...(input ? { edit: scoreEdit(input, bytes) } : {}),
  };
  const data = dataFor(bytes, scope);
  try {
    const values = readXlsxValues(await renderer({ kind: 'xlsx', template: bytes, data, format: 'xlsx', hardRefresh: true }));
    scores.errorCells = values.filter((v) => v.type === 'e').map((v) => `${cellName(v.sheet, v.ref)} ${String(v.value)}`);
    scores.totals = scoreTotals(values);
    scores.typed = scoreTypes(bytes, data, values);
    const pdf = await renderer({ kind: 'xlsx', template: bytes, data, format: 'pdf' });
    const sizes = pageSizes(pdf);
    scores.pdf = { a4: sizes.length > 0 && sizes.every(isA4), pages: sizes.length || null, sizes: [...new Set(sizes.map(([w, h]) => `${Math.round(w)} x ${Math.round(h)}`))] };
  } catch (error) {
    const detail = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? ` Carbone said: ${error.detail}` : '';
    scores.renderError = `${error instanceof Error ? error.message : String(error)}${detail}`;
  }
  return scores;
}

// --- The agent --------------------------------------------------------------------------

interface Run {
  bytes: Uint8Array;
  wroteFile: boolean;
  steps: number;
  toolErrors: string[];
  asked: number;
  answer: string;
  ms: number;
}

/** The id of the user's own file in the draft, a UUID as the draft schema wants. */
const USER_FILE_ID = '00000000-0000-4000-8000-0000000000ae';

/** What the evaluator answers when the agent asks the user something: go on with what it recommends. */
const GO_ON = 'Go with what you recommend.';
/** Most times the evaluator answers a question in one case. */
const MAX_ANSWERS = 2;

async function runAgent(c: Case, store: MemoryDraft, input: Uint8Array | undefined): Promise<Run> {
  const started = Date.now();
  const model = languageModel({ provider, id: modelId, effort, baseUrl: process.env.SPOOLDOC_LOCAL_BASE_URL ?? null, apiKey: provider === 'local' ? process.env.SPOOLDOC_LOCAL_API_KEY : undefined });
  const visual = takesFiles({ provider, id: modelId });
  const edition = await probeEdition(server).catch(() => 'community' as const);
  const carbone = { ok: true, at: new Date().toISOString(), edition };
  const tools = buildTools({ sample, store, masked: false, renderer, templateFile: store.readFile, images: async () => new Map(), visual });
  const messages: ModelMessage[] = [{ role: 'user', content: c.prompt }];
  const run: Run = { bytes: input ?? starterXlsx(def, c.scope), wroteFile: false, steps: 0, toolErrors: [], asked: 0, answer: '', ms: 0 };
  for (;;) {
    const instructions = buildInstructions({
      sample,
      definitionYaml: store.yaml,
      templates: store.templates,
      masked: false,
      carbone,
      fileTemplates: await fileTemplates(store.templates, store.yaml, store.readFile),
      visual,
      ...(baseline !== undefined ? { excelDesign: baseline } : {}),
    });
    const result = await generateText({
      model,
      reasoning: effort,
      instructions,
      messages,
      tools,
      stopWhen: [isStepCount(maxSteps - run.steps), askedUser],
    });
    run.steps += result.steps.length;
    for (const step of result.steps) {
      for (const part of step.content) {
        if (part.type === 'tool-error') run.toolErrors.push(`${part.toolName}: ${String(part.error)}`);
        if (part.type === 'tool-result') {
          const output = part.output as { ok?: boolean; error?: string; errors?: string[] } | undefined;
          if (output?.ok === false) run.toolErrors.push(`${part.toolName}: ${output.error ?? output.errors?.join(' ') ?? 'failed'}`);
        }
      }
    }
    run.answer = result.text;
    messages.push(...result.response.messages);
    const asked = result.steps.at(-1)?.toolResults.some((r) => r.toolName === ASK_USER_TOOL) ?? false;
    if (!asked || run.asked >= MAX_ANSWERS || run.steps >= maxSteps) break;
    run.asked++;
    messages.push({ role: 'user', content: GO_ON });
  }
  const template = store.templates[0];
  const file = template?.kind === 'xlsx' && template.fileId ? store.files.get(template.fileId) : undefined;
  if (file && template?.kind === 'xlsx' && template.fileId !== USER_FILE_ID) {
    run.bytes = file.content;
    run.wroteFile = true;
  }
  run.ms = Date.now() - started;
  return run;
}

/** A fresh draft: the invoice definition and one Excel template, with the user's file when the case has one. */
async function draftFor(c: Case): Promise<{ store: MemoryDraft; input?: Uint8Array }> {
  const store = new MemoryDraft();
  store.yaml = yaml;
  const file = c.file ? await c.file() : undefined;
  if (file) store.files.set(USER_FILE_ID, { ...file, previousId: null });
  const template: JobTemplate = { id: 'template-1', name: 'Invoices', kind: 'xlsx', fileId: file ? USER_FILE_ID : null, scope: c.scope, formats: ['xlsx', 'pdf'] };
  await store.changeTemplates(() => [template]);
  return { store, input: file?.content };
}

// --- Report -----------------------------------------------------------------------------

const ratio = (right: number, of: number): string => (of === 0 ? 'none found' : `${right}/${of}`);
const yesNo = (ok: boolean): string => (ok ? 'yes' : 'no');

function row(c: Case, s: Scores, run: Run | null): string {
  const edit = s.edit
    ? `${s.edit.changed.length === 0 ? 'parts kept' : `${s.edit.changed.length} parts changed`}; ${s.edit.lostFonts + s.edit.lostFills === 0 ? 'fonts and fills kept' : `${s.edit.lostFonts} fonts, ${s.edit.lostFills} fills lost`}; ${s.edit.newCells - s.edit.otherFont.length}/${s.edit.newCells} new cells in ${USER_FONT}`
    : '';
  const pdf = s.pdf ? `${yesNo(s.pdf.a4)}, ${s.pdf.pages ?? '?'} p.` : 'not rendered';
  const cells = [
    c.id,
    String(s.problems.length),
    s.renderError ? 'not rendered' : String(s.errorCells.length),
    s.renderError ? '' : ratio(s.totals.right, s.totals.checked),
    s.renderError ? '' : ratio(s.typed.numbers, s.typed.checked),
    `${s.pageSetup.ok}/${s.pageSetup.sheets}`,
    pdf,
    edit,
    run ? String(run.steps) : '',
    run ? String(run.toolErrors.length) : '',
    run ? `${(run.ms / 1000).toFixed(1)} s` : '',
  ];
  return `| ${cells.join(' | ')} |`;
}

function notes(c: Case, s: Scores, run: Run | null): string {
  const lines = [`### ${c.id}`, '', `Prompt: "${c.prompt}" (${c.scope === 'splf' ? 'one file per spooled file' : 'one file per page group'})`, ''];
  const list = (title: string, items: string[], max = 10) => {
    if (items.length === 0) return;
    lines.push(`${title}:`);
    lines.push(...items.slice(0, max).map((item) => `- ${item.replace(/\n/g, ' ')}`));
    if (items.length > max) lines.push(`- and ${items.length - max} more`);
    lines.push('');
  };
  if (run) {
    lines.push(`${run.wroteFile ? 'The agent wrote a file.' : 'The agent wrote no file: the scores are for the file it started with.'} Questions answered for the user: ${run.asked}.`, '');
  }
  if (s.renderError) lines.push(`Render failed: ${s.renderError}`, '');
  list('checkXlsx problems', s.problems);
  list('Formula error cells', s.errorCells);
  list('Totals that are wrong', s.totals.wrong);
  list('Number and date fields that are not number cells', s.typed.wrong, 5);
  list('Page setup', s.pageSetup.notes);
  if (s.pdf && !s.pdf.a4) lines.push(`PDF page sizes (points): ${s.pdf.sizes.join(', ')}`, '');
  if (s.edit) {
    list('Parts of the user file that changed', s.edit.changed);
    list(`New cells not in ${USER_FONT}`, s.edit.otherFont);
  }
  if (run) {
    list('Tool errors', run.toolErrors.map((e) => (e.length > 300 ? `${e.slice(0, 300)}...` : e)));
    if (run.answer) lines.push('The agent ended with:', '', ...run.answer.slice(0, 600).split('\n').map((l) => `> ${l}`), '');
  }
  return lines.join('\n');
}

// --- Main -------------------------------------------------------------------------------

const status = await carboneStatus(server).catch((error: unknown) => stop(`Carbone at ${carboneUrl} does not answer: ${error instanceof Error ? error.message : String(error)}`));
const rows: string[] = [];
const details: string[] = [];
for (const c of cases) {
  const { store, input } = await draftFor(c);
  console.error(`${c.id}: ${dryRun ? 'scoring the starting file' : 'running the agent'}...`);
  let run: Run | null = null;
  let bytes = input ?? starterXlsx(def, c.scope);
  if (!dryRun) {
    try {
      run = await runAgent(c, store, input);
      bytes = run.bytes;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      rows.push(`| ${c.id} | the agent failed: ${text.replace(/\|/g, '/').slice(0, 200)} |`);
      details.push(`### ${c.id}\n\nThe agent failed: ${text}\n`);
      continue;
    }
  }
  const scores = await score(bytes, c.scope, input);
  rows.push(row(c, scores, run));
  details.push(notes(c, scores, run));
}

const header = [
  '## Excel agent eval',
  '',
  `- Model: ${dryRun ? 'none (dry run: the starting files are scored)' : `${provider}:${modelId}, effort ${effort}`}`,
  `- Design guidance: ${baseline !== undefined ? `baseline skill text (${baseline.length} characters) in place of Spooldoc's` : "Spooldoc's"}`,
  `- Carbone ${status.version}; definition and sample: the invoice fixture (${pageGroups.length} page groups); at most ${maxSteps} steps per case`,
  '',
  '| Case | checkXlsx problems | Error cells | Totals right | Number and date cells | Page setup | A4 PDF | Edit kept | Steps | Tool errors | Time |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
const report = [...header, ...rows, '', ...details].join('\n');
console.log(report);
if (args.out) writeFileSync(args.out, `${report}\n`);
