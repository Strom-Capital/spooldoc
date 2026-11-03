'use client';

import { type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
  LOOKUP_NAME,
  LOOKUP_PARAMETER,
  lookupParameterNames,
  lookupSubject,
  lookupUntested,
  MAX_LOOKUP_KEYS,
  parameterValue,
  sqlParameters,
  type Db2Lookup,
  type Lookup,
  type TableLookup,
} from '@spooldoc/core/lookups';
import { DatabaseIcon, FlaskConicalIcon, PlusIcon, Table2Icon, Trash2Icon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { CodeEditor } from '@/components/workbench/code-editor';
import { CopyButton, JsonView } from '@/components/workbench/json-view';
import { PaneTabs, SplitPanes } from '@/components/workbench/split-panes';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { ApiError, api, errorText, shownError, type ShownError } from '@/lib/client/api';
import type { LookupsPreview } from '@/lib/client/render';
import type { LookupTableSummary, LookupTestView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { currentColumns, lookupSummary, previewFor, summaryText, testedColumns } from '@/lib/client/lookups';
import { useJob } from './job-provider';
import { DraftStatus, NoSample, StepHeader } from './workbench-steps';

/** A Test that failed: what to do, the system's own text, and each problem when there are several. */
type TestError = ShownError & { problems?: string[] };

/** The last Test of a lookup in this session, for what it read (see `lookupSubject`), the preview file and the page group it ran with. */
interface TestOutcome {
  subject: string;
  sampleId: string | null;
  pageGroup: number;
  view?: LookupTestView;
  error?: TestError;
}

type LookupState = 'ok' | 'untested' | 'warn' | 'error';

const DOT: Record<LookupState, string> = {
  ok: 'bg-emerald-500',
  untested: 'bg-destructive',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
};

const STATE_LABEL: Record<LookupState, string> = { ok: 'Ready', untested: 'Not tested', warn: 'Found no row', error: 'Problem' };

/** The Runs value for once per page group: no table has this name, since it is not one templates can read. */
const PAGE_GROUP = '*pageGroup';

/** The most lookups a job takes, as the job format says. */
const MAX_LOOKUPS = 20;

const runsLabel = (lookup: Pick<Lookup, 'for'>): string => (lookup.for ? `Once per row of ${lookup.for}` : 'Once per page group');

/** A change to the picked lookup: fields of either kind. */
type LookupPatch = Partial<Db2Lookup> | Partial<TableLookup>;

/** The lookup as the other kind: its name, runs, rows and when no row is found stay; the SQL, or the table and key, start empty. */
function withSource(lookup: Lookup, source: 'db2' | 'table'): Lookup {
  const shared = { name: lookup.name, ...(lookup.for !== undefined ? { for: lookup.for } : {}), result: lookup.result, missing: lookup.missing };
  return source === 'table' ? { source: 'table', ...shared, table: '', key: [{ column: '', param: '' }] } : { ...shared, sql: '' };
}

/** A value as the SQL editor shows it after its parameter. */
function shortValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  const text = String(value);
  return text.length > 24 ? `${text.slice(0, 23)}...` : text;
}

/** The value of a parameter, shown after it in the SQL. */
class ValueWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: ValueWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-param-value';
    span.textContent = this.text;
    return span;
  }
}

/**
 * Each `:name` in the SQL with its value from the page group shown, such as `‹10042›`
 * after `:customerNo`, and a name the data does not have underlined, with the known names
 * as its title.
 */
function parameterHints(values: ReadonlyMap<string, unknown>, known: readonly string[]): Extension {
  const unknownTitle = known.length > 0 ? `Not in the data. Known names: ${known.join(', ')}` : 'Not in the data.';
  const build = (view: EditorView): DecorationSet =>
    Decoration.set(
      sqlParameters(view.state.doc.toString()).map((p) =>
        values.has(p.name)
          ? Decoration.widget({ widget: new ValueWidget(`‹${shortValue(values.get(p.name))}›`), side: 1 }).range(p.end)
          : Decoration.mark({ class: 'cm-param-unknown', attributes: { title: unknownTitle } }).range(p.start, p.end),
      ),
      true,
    );
  return [
    // The pane is narrow: long lines wrap, so the end of the statement and its values stay in view.
    EditorView.lineWrapping,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.decorations = build(update.view);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.theme({
      '.cm-param-value': {
        marginLeft: '4px',
        padding: '0 4px',
        borderRadius: '3px',
        backgroundColor: 'var(--muted)',
        color: 'var(--muted-foreground)',
        fontSize: '11px',
      },
      '.cm-param-unknown': { textDecoration: 'underline wavy var(--destructive)', textUnderlineOffset: '3px' },
    }),
  ];
}

/** The tags templates write for a lookup's columns: `{d.pg.customer.EMAIL}`, `{d.pg.lines[i].product.DESC}`. */
function templateTags(lookup: Lookup, columns: readonly { name: string }[]): string[] {
  const base = lookup.for ? `d.pg.${lookup.for}[i].${lookup.name}` : `d.pg.${lookup.name}`;
  return columns.map((c) => (lookup.result === 'many' ? `{${base}[i].${c.name}}` : `{${base}.${c.name}}`));
}

/** A new lookup's name: lookup1, lookup2, ..., one no other lookup has. */
function newName(lookups: readonly Lookup[]): string {
  for (let n = lookups.length + 1; ; n++) {
    const name = `lookup${n}`;
    if (!lookups.some((l) => l.name === name)) return name;
  }
}

/** The values and names a lookup's parameters can read in the page group shown. */
function parameterScope(lookup: Lookup, index: number, lookups: readonly Lookup[], group: Record<string, unknown> | undefined) {
  if (!group) return { values: new Map<string, unknown>(), known: [] as string[] };
  const row = lookup.for !== undefined && Array.isArray(group[lookup.for]) ? (group[lookup.for] as Record<string, unknown>[])[0] : undefined;
  const scopes = row ? [row, group] : [group];
  const single = (scope: Record<string, unknown>) => Object.keys(scope).filter((key) => scope[key] === null || typeof scope[key] !== 'object');
  const known = new Set<string>(scopes.flatMap(single));
  for (const earlier of lookups.slice(0, index)) {
    if (earlier.result !== 'one' || (earlier.for !== undefined && earlier.for !== lookup.for)) continue;
    for (const column of testedColumns(earlier)) known.add(`${earlier.name}.${column.name}`);
  }
  const values = new Map<string, unknown>();
  for (const name of lookupParameterNames(lookup)) {
    const found = parameterValue(name, scopes);
    if (found.found && (found.value === null || typeof found.value !== 'object')) values.set(name, found.value);
  }
  return { values, known: [...known].sort() };
}

/** The state of a lookup in the list: untested, a problem, no row found, or ready. */
function lookupState(lookup: Lookup, index: number, preview: LookupsPreview | undefined): LookupState {
  if (lookupUntested(lookup)) return 'untested';
  if (preview?.problems.some((p) => p.index === index) || preview?.error?.lookup === lookup.name) return 'error';
  if (preview?.misses.some((m) => m.lookup === lookup.name)) return 'warn';
  return 'ok';
}

/**
 * Lookups: queries against Db2 for i, or matches in lookup tables kept in Spooldoc, that
 * add values to each page group, between Extract and Render. The list and the form of the
 * picked lookup on the left; its Test and the page group's JSON, as templates get it, on
 * the right.
 */
export function LookupsStep() {
  const { spec, readOnly, updateDraft, servers, job, noteServerCall } = useJob();
  const { render, sampleId, pageGroupIndex } = useWorkbench();
  const lookups = spec.lookups;
  const [picked, setPicked] = useState(0);
  const [tab, setTab] = useState<'test' | 'json'>('test');
  const [outcomes, setOutcomes] = useState<Record<number, TestOutcome>>({});
  const [testing, setTesting] = useState<number | null>(null);
  const [tables, setTables] = useState<LookupTableSummary[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const index = Math.min(picked, Math.max(0, lookups.length - 1));
  const lookup = lookups[index];
  const server = servers.find((s) => s.id === spec.source.serverId);
  const preview = previewFor(render, pageGroupIndex);
  // A Test of another page group or preview file is not this one's: the pane shows the preview's instead.
  const outcome = outcomes[index];
  const shownOutcome = outcome && outcome.pageGroup === pageGroupIndex && outcome.sampleId === sampleId ? outcome : undefined;

  // The latest lookups, so a Test that ends after more typing writes its result into them.
  const latest = useRef(lookups);
  useEffect(() => {
    latest.current = lookups;
  }, [lookups]);

  useEffect(() => {
    api<{ tables: LookupTableSummary[] }>('/api/lookup-tables').then(
      (data) => setTables(data.tables),
      (err) => setTablesError(errorText(err)),
    );
  }, []);

  const setLookups = useCallback(
    (next: Lookup[], debounce?: boolean) => updateDraft({ lookups: next }, debounce === undefined ? {} : { debounce }),
    [updateDraft],
  );
  const change = (patch: LookupPatch, debounce?: boolean) => {
    setLookups(
      lookups.map((l, i) => (i === index ? ({ ...l, ...patch } as Lookup) : l)),
      debounce,
    );
  };

  const changeSource = (source: 'db2' | 'table') => {
    if (!lookup || (lookup.source === 'table') === (source === 'table')) return;
    setLookups(
      lookups.map((l, i) => (i === index ? withSource(l, source) : l)),
      false,
    );
  };

  function add() {
    const next = [...lookups, { name: newName(lookups), sql: '', result: 'one' as const, missing: 'warn' as const }];
    setLookups(next, false);
    setPicked(next.length - 1);
    setTab('test');
  }

  function remove() {
    if (!lookup) return;
    setLookups(
      lookups.filter((_, i) => i !== index),
      false,
    );
    setOutcomes({});
    setPicked(Math.max(0, index - 1));
  }

  async function test() {
    if (!lookup) return;
    const at = index;
    const subject = lookupSubject(lookup);
    const name = lookup.name.trim() || `Lookup ${at + 1}`;
    // A table lookup needs the IBM i only for an earlier Db2 for i lookup.
    const usesServer = lookups.slice(0, at + 1).some((l) => l.source !== 'table');
    setTesting(at);
    setTab('test');
    try {
      const view = await api<LookupTestView>(`/api/jobs/${job.id}/lookups/test`, {
        method: 'POST',
        body: { lookups, index: at, sampleId: sampleId ?? undefined, pageGroup: pageGroupIndex },
      });
      setOutcomes((current) => ({ ...current, [at]: { subject, sampleId, pageGroup: pageGroupIndex, view } }));
      if (spec.source.serverId && usesServer) noteServerCall(spec.source.serverId, null);
      // Only a lookup whose SQL, or table and key, is still the one tested is marked tested.
      const now = latest.current;
      if (now[at] && lookupSubject(now[at]) === subject) {
        setLookups(
          now.map((l, i) => (i === at ? ({ ...l, checked: view.checked } as Lookup) : l)),
          false,
        );
      }
      toast.success(`Tested ${name}: ${view.rowCount} ${view.rowCount === 1 ? 'row' : 'rows'}`);
    } catch (err) {
      const shown = shownError(err);
      const problems = err instanceof ApiError ? (err.body as { problems?: unknown } | undefined)?.problems : undefined;
      const error: TestError = { ...shown, ...(Array.isArray(problems) && problems.length > 1 ? { problems: problems.map(String) } : {}) };
      setOutcomes((current) => ({ ...current, [at]: { subject, sampleId, pageGroup: pageGroupIndex, error } }));
      if (spec.source.serverId && usesServer && (shown.code === 'host' || shown.code === 'auth')) noteServerCall(spec.source.serverId, shown);
    } finally {
      setTesting(null);
    }
  }

  if (lookups.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StepHeader />
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <EmptyState
            icon={DatabaseIcon}
            title="No lookups"
            description="A lookup reads values from Db2 for i, such as a customer's email address, or from a lookup table kept in Spooldoc, and adds them to each document. The program and its spooled file stay as they are."
            className="mx-auto max-w-2xl"
          >
            {!readOnly && (
              <Button size="sm" onClick={add}>
                <PlusIcon />
                Add lookup
              </Button>
            )}
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepHeader />
      <div className="min-h-0 flex-1">
        <SplitPanes
          labels={['Lookups', 'Test and JSON']}
          initial={0.5}
          left={
            <LookupForm
              lookups={lookups}
              index={index}
              onPick={setPicked}
              onAdd={add}
              onRemove={remove}
              onChange={change}
              onSource={changeSource}
              tables={tables}
              tablesError={tablesError}
              onTest={() => void test()}
              testing={testing !== null}
              readOnly={readOnly}
              host={server?.host ?? null}
              hasServer={!!spec.source.serverId}
              hasSample={!!sampleId}
              preview={preview}
            />
          }
          right={
            <div className="flex h-full min-h-0 flex-col">
              <PaneTabs<'test' | 'json'>
                tabs={[
                  { id: 'test', label: 'Test' },
                  { id: 'json', label: 'JSON' },
                ]}
                value={tab}
                onChange={setTab}
                end={<DraftStatus />}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {!sampleId ? (
                  <NoSample />
                ) : tab === 'json' ? (
                  <JsonView withLookups />
                ) : lookup ? (
                  <TestPane lookup={lookup} index={index} outcome={shownOutcome} testing={testing === index} preview={preview} />
                ) : null}
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

function LookupForm({
  lookups,
  index,
  onPick,
  onAdd,
  onRemove,
  onChange,
  onSource,
  tables: lookupTables,
  tablesError,
  onTest,
  testing,
  readOnly,
  host,
  hasServer,
  hasSample,
  preview,
}: {
  lookups: Lookup[];
  index: number;
  onPick(index: number): void;
  onAdd(): void;
  onRemove(): void;
  onChange(patch: LookupPatch, debounce?: boolean): void;
  onSource(source: 'db2' | 'table'): void;
  /** The lookup tables there are, or null while they load. */
  tables: LookupTableSummary[] | null;
  tablesError: string | null;
  onTest(): void;
  testing: boolean;
  readOnly: boolean;
  host: string | null;
  hasServer: boolean;
  hasSample: boolean;
  preview: LookupsPreview | undefined;
}) {
  const { render, pageGroupIndex } = useWorkbench();
  const lookup = lookups[index]!;
  const group = preview?.pageGroup ?? render?.extract?.pageGroups[pageGroupIndex];
  const tables = useMemo(() => {
    // The lists of the page group, without the ones lookups that read all rows added.
    const names = Object.keys(group ?? {}).filter((key) => Array.isArray(group?.[key]) && !lookups.some((l) => l.name === key));
    return lookup.for && !names.includes(lookup.for) ? [...names, lookup.for] : names;
  }, [group, lookup.for, lookups]);
  const { values, known } = useMemo(() => parameterScope(lookup, index, lookups, group), [lookup, index, lookups, group]);
  const problems = (preview?.problems ?? []).filter((p) => p.index === index).map((p) => p.message);
  const untested = lookupUntested(lookup);
  const table = lookup.source === 'table' ? lookupTables?.find((t) => t.id === lookup.table) : undefined;
  // A table lookup needs the IBM i only when an earlier lookup reads Db2 for i.
  const needsServer = lookup.source !== 'table' || lookups.slice(0, index).some((l) => l.source !== 'table');
  const why = readOnly
    ? 'You are viewing a saved version. Switch to the draft to test.'
    : needsServer && !hasServer
      ? lookup.source === 'table'
        ? 'Pick a server in the Source step first. An earlier lookup runs on its IBM i.'
        : 'Pick a server in the Source step first. Lookups run on its IBM i.'
      : !hasSample
        ? 'Pick a spooled file first, so the lookup has values to run with.'
        : lookup.source === 'table'
          ? !lookup.table
            ? 'Pick a lookup table first.'
            : lookup.key.some((k) => !k.column.trim() || !k.param.trim())
              ? 'Pick each key column and the value it must equal first.'
              : null
          : !lookup.sql.trim()
            ? 'Write the SQL first.'
            : null;
  const testHint =
    lookup.source === 'table'
      ? `Matches the key against ${table?.name ?? 'the lookup table'} with the values from this page group. Nothing changes in the table.`
      : `Checks the SQL on ${host ?? 'the IBM i'} and runs it with the values from this page group. Lookups only read; nothing changes on the IBM i.`;
  const id = (part: string) => `lookup-${index}-${part}`;

  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-col gap-4 p-3">
        <section aria-labelledby="lookups-heading" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 id="lookups-heading" className="font-medium text-sm">
              Lookups
            </h2>
            {!readOnly && (
              <div className="ml-auto">
                <Hint text={lookups.length >= MAX_LOOKUPS ? `A job takes up to ${MAX_LOOKUPS} lookups.` : undefined}>
                  <Button size="xs" variant="outline" onClick={onAdd} disabled={lookups.length >= MAX_LOOKUPS}>
                    <PlusIcon />
                    Add lookup
                  </Button>
                </Hint>
              </div>
            )}
          </div>
          <ul className="divide-y rounded-md border">
            {lookups.map((l, i) => {
              const state = lookupState(l, i, preview);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onPick(i)}
                    aria-current={i === index ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      i === index && 'bg-primary/10',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{l.name.trim() || `Lookup ${i + 1}`}</span>
                    <span className="truncate text-muted-foreground text-xs">{runsLabel(l).toLowerCase()}</span>
                    <span className={cn('size-2 shrink-0 rounded-full', DOT[state])} aria-hidden title={STATE_LABEL[state]} />
                    <span className="sr-only">{STATE_LABEL[state]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-col gap-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id('name')}>Name</Label>
              <Input
                id={id('name')}
                value={lookup.name}
                onChange={(event) => onChange({ name: event.target.value })}
                disabled={readOnly}
                spellCheck={false}
                aria-invalid={!!lookup.name && !LOOKUP_NAME.test(lookup.name)}
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id('runs')}>Runs</Label>
              <Select value={lookup.for ?? PAGE_GROUP} onValueChange={(value) => onChange({ for: value === PAGE_GROUP ? undefined : value }, false)} disabled={readOnly}>
                <SelectTrigger id={id('runs')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PAGE_GROUP}>Once per page group</SelectItem>
                  {tables.map((table) => (
                    <SelectItem key={table} value={table}>
                      Once per row of {table}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id('source')}>Source</Label>
            <Select value={lookup.source === 'table' ? 'table' : 'db2'} onValueChange={(value) => onSource(value as 'db2' | 'table')} disabled={readOnly}>
              <SelectTrigger id={id('source')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="db2">Db2 for i</SelectItem>
                <SelectItem value="table">Lookup table</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {lookup.source === 'table' ? (
            <TableFields
              lookup={lookup}
              id={id}
              tables={lookupTables}
              tablesError={tablesError}
              values={values}
              known={known}
              readOnly={readOnly}
              onChange={onChange}
            />
          ) : (
            <SqlFields lookup={lookup} id={id} values={values} known={known} readOnly={readOnly} onChange={onChange} />
          )}
          {/* One above the other: the pane is often too narrow for both, and the texts stay whole. */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id('rows')}>Rows</Label>
              <Select value={lookup.result} onValueChange={(value) => onChange({ result: value as Lookup['result'] }, false)} disabled={readOnly}>
                <SelectTrigger id={id('rows')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one">One row</SelectItem>
                  <SelectItem value="many">All rows</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id('missing')}>When no row is found</Label>
              <Select value={lookup.missing} onValueChange={(value) => onChange({ missing: value as Lookup['missing'] }, false)} disabled={readOnly}>
                <SelectTrigger id={id('missing')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Stop the run</SelectItem>
                  <SelectItem value="warn">Warn and leave it empty</SelectItem>
                  <SelectItem value="empty">Leave it empty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs" aria-label="Problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {untested && !readOnly && <p className="text-muted-foreground text-xs">Test this lookup to save a version with it.</p>}
          <div className="flex items-center gap-2">
            <Hint text={why ?? testHint}>
              <Button size="sm" onClick={onTest} disabled={!!why || testing}>
                {testing ? <Spinner /> : <FlaskConicalIcon />}
                {testing ? 'Testing...' : 'Test'}
              </Button>
            </Hint>
            {!readOnly && (
              <Hint text="Removes the lookup from the draft. Saved versions keep it.">
                <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
                  <Trash2Icon />
                  Remove
                </Button>
              </Hint>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The SQL of a Db2 for i lookup, with the value of each parameter in the page group shown. */
function SqlFields({
  lookup,
  id,
  values,
  known,
  readOnly,
  onChange,
}: {
  lookup: Db2Lookup;
  id(part: string): string;
  values: ReadonlyMap<string, unknown>;
  known: readonly string[];
  readOnly: boolean;
  onChange(patch: LookupPatch, debounce?: boolean): void;
}) {
  const hintsKey = JSON.stringify([[...values], known]);
  // Rebuilt only when the values or names change, so the editor keeps its decorations while typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hintsKey stands for values and known
  const hints = useMemo(() => parameterHints(values, known), [hintsKey]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={id('sql-label')}>SQL</Label>
      <div className="min-h-28 overflow-hidden rounded-md border">
        <CodeEditor
          value={lookup.sql}
          onChange={(sql) => onChange({ sql })}
          label={`SQL of ${lookup.name || 'the lookup'}`}
          language="sql"
          placeholder="SELECT EMAIL FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNo"
          readOnly={readOnly}
          autoHeight
          extensions={hints}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {lookup.for
          ? `One SELECT, run once per row of ${lookup.for}. A column of the row or a field of the page group can be a parameter, such as :item. Its value is bound, never written into the SQL.`
          : 'One SELECT. Write a field of the page group as a parameter, such as :customerNo. Its value is bound, never written into the SQL.'}
      </p>
    </div>
  );
}

/**
 * The table and key of a table lookup: the lookup table, and key rows of a column and
 * the value it must equal, such as CODE and :termsCode, each with its value in the page
 * group shown.
 */
function TableFields({
  lookup,
  id,
  tables,
  tablesError,
  values,
  known,
  readOnly,
  onChange,
}: {
  lookup: TableLookup;
  id(part: string): string;
  tables: LookupTableSummary[] | null;
  tablesError: string | null;
  values: ReadonlyMap<string, unknown>;
  known: readonly string[];
  readOnly: boolean;
  onChange(patch: LookupPatch, debounce?: boolean): void;
}) {
  const table = tables?.find((t) => t.id === lookup.table);
  const columns = table?.columns ?? [];
  const setKey = (i: number, patch: Partial<TableLookup['key'][number]>, debounce?: boolean) =>
    onChange({ key: lookup.key.map((k, at) => (at === i ? { ...k, ...patch } : k)) }, debounce);

  if (tablesError) return <ErrorNote>Could not load the lookup tables: {tablesError}</ErrorNote>;
  if (tables === null) return <Loading>Loading lookup tables...</Loading>;
  if (tables.length === 0) {
    return (
      <EmptyState
        icon={Table2Icon}
        title="No lookup tables yet"
        description="A lookup table holds values the document needs that are not in Db2 for i, such as the text of a payment terms code."
        className="py-6"
      >
        <Button size="sm" variant="outline" asChild>
          <Link href="/lookup-tables">Open Lookup tables</Link>
        </Button>
      </EmptyState>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('table')}>Table</Label>
        <Select value={table ? lookup.table : ''} onValueChange={(value) => onChange({ table: value }, false)} disabled={readOnly}>
          <SelectTrigger id={id('table')} className="w-full font-mono">
            <SelectValue placeholder={lookup.table ? (lookup.checked?.tableName ? `${lookup.checked.tableName} (deleted)` : 'A deleted table') : 'Pick a table'} />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.id} value={t.id} className="font-mono">
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">Key</legend>
        <ul className="flex flex-col gap-2">
          {lookup.key.map((key, i) => {
            const param = key.param.trim().replace(/^:/, '');
            const shownValue = !param ? null : values.has(param) ? `‹${shortValue(values.get(param))}›` : LOOKUP_PARAMETER.test(param) ? 'Not in the data' : null;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Select value={key.column} onValueChange={(value) => setKey(i, { column: value }, false)} disabled={readOnly || !table}>
                  <SelectTrigger aria-label={`Column of key ${i + 1}`} className="w-40 font-mono">
                    <SelectValue placeholder="Column" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.name} value={c.name} className="font-mono">
                        {c.name}
                      </SelectItem>
                    ))}
                    {key.column && !columns.some((c) => c.name === key.column) && (
                      <SelectItem value={key.column} className="font-mono">
                        {key.column}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground text-sm">equals</span>
                <Input
                  value={key.param ? `:${param}` : ''}
                  onChange={(event) => setKey(i, { param: event.target.value.replace(/^:/, '') })}
                  placeholder=":termsCode"
                  aria-label={`Value of key ${i + 1}`}
                  aria-invalid={!!param && !LOOKUP_PARAMETER.test(param)}
                  title={shownValue === 'Not in the data' && known.length > 0 ? `Known names: ${known.join(', ')}` : undefined}
                  disabled={readOnly}
                  spellCheck={false}
                  list={id(`names-${i}`)}
                  className="w-44 flex-1 font-mono"
                />
                <datalist id={id(`names-${i}`)}>
                  {known.map((name) => (
                    <option key={name} value={`:${name}`} />
                  ))}
                </datalist>
                {shownValue && (
                  <span className={cn('rounded px-1 font-mono text-xs', shownValue === 'Not in the data' ? 'text-destructive' : 'bg-muted text-muted-foreground')}>
                    {shownValue}
                  </span>
                )}
                {!readOnly && lookup.key.length > 1 && (
                  <Hint text="Remove this key column">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove key ${i + 1}`}
                      onClick={() => onChange({ key: lookup.key.filter((_, at) => at !== i) }, false)}
                    >
                      <XIcon />
                    </Button>
                  </Hint>
                )}
              </li>
            );
          })}
        </ul>
        {!readOnly && (
          <div>
            <Hint text={lookup.key.length >= MAX_LOOKUP_KEYS ? `A lookup matches on up to ${MAX_LOOKUP_KEYS} key columns.` : undefined}>
              <Button
                size="xs"
                variant="outline"
                onClick={() => onChange({ key: [...lookup.key, { column: '', param: '' }] }, false)}
                disabled={lookup.key.length >= MAX_LOOKUP_KEYS}
              >
                <PlusIcon />
                Add key column
              </Button>
            </Hint>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          {lookup.for
            ? `A row of the table matches when each key column equals its value. A column of the row of ${lookup.for} or a field of the page group can be a value, such as :item.`
            : 'A row of the table matches when each key column equals its value, such as a field of the page group: :termsCode. Numbers compare as numbers, and text as it is written, without spaces at the ends.'}
        </p>
      </fieldset>
    </>
  );
}

/** The Test of the picked lookup: its last result in this session, else what the preview and its last Test say. */
function TestPane({
  lookup,
  index,
  outcome,
  testing,
  preview,
}: {
  lookup: Lookup;
  index: number;
  outcome: TestOutcome | undefined;
  testing: boolean;
  preview: LookupsPreview | undefined;
}) {
  const name = lookup.name.trim() || `Lookup ${index + 1}`;
  const stale = outcome !== undefined && outcome.subject !== lookupSubject(lookup);
  const view = outcome?.view;
  // Columns of a Test of other SQL are not this lookup's any more.
  const columns = currentColumns(lookup, outcome);
  const columnsStale = columns.length === 0 && (lookup.checked?.columns.length ?? 0) > 0;
  const summary = lookupSummary(lookup, preview);
  const summarized = summaryText(lookup, summary);
  const value = !lookup.for ? preview?.pageGroup?.[lookup.name] : undefined;
  const valueRow = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  const misses = (preview?.misses ?? []).filter((m) => m.lookup === lookup.name);
  const previewError = preview?.error && (preview.error.lookup === undefined || preview.error.lookup === lookup.name) ? preview.error : undefined;

  return (
    <div className="flex flex-col gap-4 p-3 text-sm" aria-busy={testing}>
      {testing && (
        <div role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden />
          Testing {name}...
        </div>
      )}
      {stale && (
        <p className="text-muted-foreground text-xs">
          {lookup.source === 'table' ? 'The table or the key changed since this Test.' : 'The SQL changed since this Test.'} Test it again.
        </p>
      )}
      {outcome?.error && (
        <ErrorNote detail={outcome.error.detail}>
          {outcome.error.message}
          {outcome.error.problems && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {outcome.error.problems.slice(1).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </ErrorNote>
      )}
      {!outcome && previewError && <ErrorNote detail={previewError.detail}>{previewError.message}</ErrorNote>}
      {!outcome && !testing && lookupUntested(lookup) && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground">Test this lookup to save a version with it.</p>
      )}

      {view && (
        <>
          <p className="text-muted-foreground text-xs">
            {view.table ? (
              <>
                Matched in <span className="font-mono">{view.table.name}</span>, revision {view.table.revision}
              </>
            ) : (
              <>Checked on {view.host}</>
            )}
            , {view.ms} ms{view.row !== undefined && lookup.for ? `, with row ${view.row + 1} of ${lookup.for}` : ''}.
          </p>
          {view.parameters.length > 0 && (
            <section aria-labelledby="test-parameters">
              <h3 id="test-parameters" className="mb-1 font-medium">
                Parameters
              </h3>
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  {view.parameters.map((p, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 font-mono">:{p.name}</td>
                      <td className="py-1 pr-3 font-mono">{p.value === null ? '(empty)' : String(p.value)}</td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{p.source}</td>
                      <td className="py-1 text-right text-muted-foreground">{p.column !== undefined ? <span className="font-mono">= {p.column}</span> : p.marker}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <section aria-labelledby="test-rows">
            <h3 id="test-rows" className="mb-1 font-medium">
              {view.rowCount === 0 ? 'No row found' : view.rowCount === 1 ? '1 row' : `${view.rowCount} rows`}
              {view.rowCount > view.rows.length && <span className="font-normal text-muted-foreground">, first {view.rows.length} shown</span>}
            </h3>
            {view.rowCount === 0 ? (
              <p className="text-muted-foreground text-xs">
                {lookup.missing === 'fail'
                  ? 'A run stops when no row is found. Check the values, or set When no row is found to Warn and leave it empty.'
                  : 'A run leaves the columns empty when no row is found.'}
              </p>
            ) : (
              <div className="overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {view.columns.map((c) => (
                        <th key={c.name} scope="col" className="px-2 py-1 text-left font-medium" title={c.db2 ?? undefined}>
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {view.rows.map((row, i) => (
                      <tr key={i}>
                        {view.columns.map((c) => (
                          <td key={c.name} className={cn('px-2 py-1 font-mono', c.type === 'number' && 'text-right tabular-nums')}>
                            {row[c.name] === null || row[c.name] === undefined ? '' : String(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!view && !lookupUntested(lookup) && summarized && (
        <section aria-labelledby="preview-lookup" className="flex flex-col gap-2">
          <h3 id="preview-lookup" className="font-medium">
            This page group
          </h3>
          <p className="text-muted-foreground text-xs">{summarized}</p>
          {!lookup.for && summary.parameters.length > 0 && (
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {summary.parameters.map((p, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 font-mono">:{p.name}</td>
                    <td className="py-1 font-mono">{p.value === null ? '(empty)' : String(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {valueRow && summary.rows > 0 && (
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {Object.entries(valueRow).map(([column, v]) => (
                  <tr key={column}>
                    <td className="py-1 pr-3 font-mono">{column}</td>
                    <td className="py-1 font-mono">{v === null || v === undefined ? '' : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {misses.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-amber-700 text-xs dark:text-amber-400" aria-label="Warnings">
          {misses.map((miss) => (
            <li key={miss.text}>{miss.text}.</li>
          ))}
        </ul>
      )}

      {columnsStale && <p className="text-muted-foreground text-xs">Test this lookup to see its columns and their tags.</p>}
      {columns.length > 0 && LOOKUP_NAME.test(lookup.name) && (
        <section aria-labelledby="test-tags">
          <h3 id="test-tags" className="mb-1 font-medium">
            In templates
          </h3>
          <ul className="flex flex-col gap-1">
            {templateTags(lookup, columns).map((tag) => (
              <li key={tag} className="flex items-center gap-1">
                <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{tag}</code>
                <CopyButton text={tag} label={`Copy ${tag}`} hint="Copy the tag to the clipboard" className="" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
