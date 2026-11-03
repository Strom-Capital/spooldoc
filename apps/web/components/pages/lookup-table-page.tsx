'use client';

import { parseCsv, toCsv, type CsvTable } from '@spooldoc/core/csv';
import { LOOKUP_NAME, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, type LookupTableColumn } from '@spooldoc/core/lookups';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  Table2Icon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { TableEmpty } from '@/components/empty-state';
import { Hint } from '@/components/hint';
import { ErrorNote, Page } from '@/components/page';
import { SkeletonRows } from '@/components/skeleton-rows';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, api, errorText } from '@/lib/client/api';
import {
  badCells,
  badCellsText,
  cellText,
  filterRows,
  jobNames,
  downloadCsv,
  newColumnName,
  toCells,
  TYPE_LABEL,
  type EditColumn,
} from '@/lib/client/lookup-tables';
import type { LookupTableView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { JobsPopover } from '@/components/jobs-popover';
import { CsvInput } from './lookup-table-csv';

/** Rows the grid shows a page. */
const PAGE_ROWS = 100;

/** A change that breaks the lookups of jobs, waiting for the user to confirm it. */
interface Pending {
  title: string;
  description: string;
  action: string;
  run(): void;
}

/** The columns of a table as saved: each knows its saved name. */
const savedColumns = (columns: readonly LookupTableColumn[]): EditColumn[] => columns.map((c) => ({ ...c, saved: c.name }));

/**
 * One lookup table: a grid of its cells, 100 rows a page, with a filter. Rows and columns
 * are added, changed and deleted here, and saved together. A cell that does not fit its
 * column is marked and keeps Save disabled. A change that breaks the lookups of jobs, and
 * leaving with unsaved changes, ask first.
 */
export function LookupTablePage({ id }: { id: string }) {
  const router = useRouter();
  const [table, setTable] = useState<LookupTableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<EditColumn[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  // A save refused because someone else saved first: the edits here can still be downloaded.
  const [conflict, setConflict] = useState(false);

  const show = useCallback((view: LookupTableView) => {
    setTable(view);
    setColumns(savedColumns(view.columns));
    setRows(view.rows.map((row) => row.map(cellText)));
    setDirty(false);
    setSaveError(null);
    setConflict(false);
  }, []);

  useEffect(() => {
    api<LookupTableView>(`/api/lookup-tables/${id}`).then(show, (err) => setError(errorText(err)));
  }, [id, show]);

  // Leaving with unsaved changes asks first: a reload or a closed tab through the browser, a link in the app through a dialog.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(url.pathname + url.search + url.hash);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);

  const bad = useMemo(() => badCells(columns, rows), [columns, rows]);
  const badSet = useMemo(() => new Set(bad.map((b) => `${b.row}:${b.column}`)), [bad]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_ROWS));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * PAGE_ROWS, (current + 1) * PAGE_ROWS);

  /** The jobs that read the table, when a change touches a column that was saved: they may print it or key on it. */
  const jobsFor = (column: EditColumn | undefined) => (column?.saved ? (table?.jobs ?? []) : []);

  function edit(next: { columns?: EditColumn[]; rows?: string[][] }) {
    if (next.columns) setColumns(next.columns);
    if (next.rows) setRows(next.rows);
    setDirty(true);
    setSaveError(null);
  }

  /**
   * Runs a change of saved columns at once, or asks first when jobs read the table: a
   * template may print the column, or a lookup key on it or read it, and each lookup needs
   * another Test before its job saves a version.
   */
  function confirmFor(jobs: readonly { name: string }[], ask: Omit<Pending, 'run' | 'description'> & { changes: string }, run: () => void) {
    if (jobs.length === 0) {
      run();
      return;
    }
    const read = jobs.length === 1 ? 'has a lookup that reads' : 'have lookups that read';
    setPending({
      ...ask,
      description: `${jobNames(jobs)} ${read} ${table?.name ?? 'this table'}. Templates and lookups that use ${ask.changes} stop working, and each lookup needs another Test before its job saves a version.`,
      run,
    });
  }

  function setCell(row: number, column: number, text: string) {
    const next = rows.slice();
    const changed = next[row]!.slice();
    changed[column] = text;
    next[row] = changed;
    edit({ rows: next });
  }

  /** Moves the focus to the cell of the same column in the row shown `by` rows down, or up. */
  function moveFocus(row: number, column: number, by: number) {
    const at = pageRows.indexOf(row) + by;
    const target = pageRows[at];
    if (target === undefined) return;
    document.querySelector<HTMLInputElement>(`[data-cell="${target}:${column}"]`)?.focus();
  }

  /** Fills a block of pasted cells from a cell to the right and down, adding rows as needed. */
  function pasteBlock(row: number, column: number, text: string) {
    let block: string[][];
    try {
      block = parseCsv(text.replace(/\r?\n$/, ''), '\t');
    } catch {
      block = text.split(/\r?\n/).map((line) => line.split('\t'));
    }
    const next = rows.slice();
    let cut = 0;
    let rowsLeft = 0;
    for (const [i, cells] of block.entries()) {
      const r = row + i;
      if (r >= MAX_TABLE_ROWS) {
        rowsLeft = block.length - i;
        break;
      }
      const target = (next[r] ?? columns.map(() => '')).slice();
      for (const [j, cell] of cells.entries()) {
        if (column + j < columns.length) target[column + j] = cell;
        else if (cell.trim() !== '') cut++;
      }
      next[r] = target;
    }
    edit({ rows: next });
    if (cut > 0) toast.warning(`${cut.toLocaleString('en-US')} pasted ${cut === 1 ? 'cell was' : 'cells were'} right of the last column and left out. Add columns first to keep them.`);
    if (rowsLeft > 0) toast.warning(`${rowsLeft.toLocaleString('en-US')} pasted ${rowsLeft === 1 ? 'row was' : 'rows were'} left out. A table has up to ${MAX_TABLE_ROWS.toLocaleString('en-US')} rows.`);
  }

  function addRow() {
    edit({ rows: [...rows, columns.map(() => '')] });
    setFilter('');
    setPage(Math.floor(rows.length / PAGE_ROWS));
  }

  function deleteRow(row: number) {
    edit({ rows: rows.filter((_, i) => i !== row) });
  }

  function moveColumn(from: number, to: number) {
    const order = columns.map((_, i) => i);
    order.splice(to, 0, order.splice(from, 1)[0]!);
    edit({ columns: order.map((i) => columns[i]!), rows: rows.map((row) => order.map((i) => row[i] ?? '')) });
  }

  function deleteColumn(index: number) {
    const column = columns[index]!;
    confirmFor(jobsFor(column), { title: `Delete the column ${column.name}?`, action: 'Delete column', changes: column.name }, () =>
      edit({ columns: columns.filter((_, i) => i !== index), rows: rows.map((row) => row.filter((_, i) => i !== index)) }),
    );
  }

  function saveColumn(index: number | 'new', next: LookupTableColumn) {
    if (index === 'new') {
      edit({ columns: [...columns, next], rows: rows.map((row) => [...row, '']) });
      setEditing(null);
      return;
    }
    const column = columns[index]!;
    const apply = () => {
      edit({ columns: columns.map((c, i) => (i === index ? { ...c, ...next } : c)) });
      setEditing(null);
    };
    if (next.name === column.name && next.type === column.type) {
      apply();
      return;
    }
    const renamed = next.name !== column.name;
    const title = renamed && next.type !== column.type ? `Rename and retype ${column.name}?` : renamed ? `Rename ${column.name} to ${next.name}?` : `Make ${column.name} a ${TYPE_LABEL[next.type].toLowerCase()} column?`;
    confirmFor(jobsFor(column), { title, action: 'Change column', changes: column.name }, apply);
  }

  function importCsv(csv: CsvTable) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const next: EditColumn[] = csv.columns.map((c) => ({ ...c, ...(byName.get(c.name)?.saved ? { saved: byName.get(c.name)!.saved } : {}) }));
    const apply = () => {
      edit({ columns: next, rows: csv.rows.map((row) => row.map(cellText)) });
      setImporting(false);
      setFilter('');
      setPage(0);
    };
    // Saved columns the CSV drops or gives another type.
    const changed = columns.filter((c) => c.saved && csv.columns.find((n) => n.name === c.name)?.type !== c.type).map((c) => c.name);
    confirmFor(changed.length > 0 ? (table?.jobs ?? []) : [], { title: `Replace the rows of ${table?.name ?? 'the table'}?`, action: 'Replace rows', changes: changed.join(', ') }, apply);
  }

  /** The grid as it is here, unsaved, as a CSV file, so a refused save loses nothing. */
  function downloadEdits() {
    const blob = new Blob([toCsv(columns, toCells(columns, rows))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${table?.name ?? 'lookup-table'}-changes.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function save() {
    if (!table) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api<LookupTableView>(`/api/lookup-tables/${table.id}`, {
        method: 'PATCH',
        body: { revision: table.revision, columns: columns.map(({ name, type }) => ({ name, type })), rows: toCells(columns, rows) },
      });
      show(saved);
      toast.success(`Saved ${saved.name}`);
    } catch (err) {
      setSaveError(errorText(err));
      setConflict(err instanceof ApiError && err.status === 409);
    }
    setSaving(false);
  }

  if (error) {
    return (
      <Page title="Lookup table" breadcrumbs={[{ label: 'Lookup tables', href: '/lookup-tables' }, { label: 'Lookup table' }]}>
        <ErrorNote>{error}</ErrorNote>
      </Page>
    );
  }

  const badText = badCellsText(columns, bad);
  const whyNoSave = !dirty ? 'No changes to save.' : badText ? `${badText} Fix it to save.` : null;
  const name = table?.name ?? 'Lookup table';

  return (
    <Page
      title={<span className="font-mono">{name}</span>}
      description={
        table ? (
          <>
            {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'row' : 'rows'}, revision {table.revision}. Read by{' '}
            <JobsPopover
              jobs={table.jobs}
              label={`${table.jobs.length} ${table.jobs.length === 1 ? 'job reads' : 'jobs read'} ${table.name}`}
              heading="Jobs with a lookup that reads it"
            />{' '}
            {table.jobs.length === 1 ? 'job' : 'jobs'}. A lookup matches rows on key columns and adds every column to the data.
          </>
        ) : undefined
      }
      breadcrumbs={[{ label: 'Lookup tables', href: '/lookup-tables' }, { label: name }]}
      actions={
        table && (
          <>
            <Hint text="Replaces the columns and rows with those of a CSV file or pasted cells. Nothing is saved until you save.">
              <Button variant="outline" onClick={() => setImporting(true)}>
                <UploadIcon />
                Import CSV
              </Button>
            </Hint>
            <Hint text={dirty ? 'Downloads the table as last saved, without the changes here.' : 'UTF-8, comma delimited, with a decimal point.'}>
              <Button variant="outline" onClick={() => void downloadCsv(table)}>
                <DownloadIcon />
                Download CSV
              </Button>
            </Hint>
            <Hint text={whyNoSave ?? undefined}>
              <Button onClick={() => void save()} disabled={!!whyNoSave || saving}>
                {saving ? <Spinner /> : <SaveIcon />}
                Save
              </Button>
            </Hint>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {saveError && (
          <ErrorNote
            action={
              conflict ? (
                <Hint text="Saves the grid as it is here, with your changes, as a CSV file. Reload, then import it to keep them.">
                  <Button size="sm" variant="outline" className="mt-2" onClick={downloadEdits}>
                    <DownloadIcon />
                    Download your changes
                  </Button>
                </Hint>
              ) : undefined
            }
          >
            {saveError}
          </ErrorNote>
        )}
        {badText && (
          <p role="status" className="text-destructive text-sm">
            {badText}
          </p>
        )}
        {table && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
                placeholder="Filter rows"
                aria-label="Filter rows"
                className="pl-8"
              />
            </div>
            {filter && (
              <span className="text-muted-foreground text-sm">
                {shown.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} rows
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Hint text={columns.length >= MAX_TABLE_COLUMNS ? `A table has up to ${MAX_TABLE_COLUMNS} columns.` : undefined}>
                <Button variant="outline" size="sm" onClick={() => setEditing('new')} disabled={columns.length >= MAX_TABLE_COLUMNS}>
                  <PlusIcon />
                  Add column
                </Button>
              </Hint>
              <Hint text={rows.length >= MAX_TABLE_ROWS ? `A table has up to ${MAX_TABLE_ROWS.toLocaleString('en-US')} rows.` : undefined}>
                <Button variant="outline" size="sm" onClick={addRow} disabled={rows.length >= MAX_TABLE_ROWS}>
                  <PlusIcon />
                  Add row
                </Button>
              </Hint>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="w-0 px-3 py-2 text-right font-medium">
                  <span className="sr-only">Row</span>#
                </th>
                {table
                  ? columns.map((column, c) => (
                      <th key={c} scope="col" className="min-w-40 px-2 py-1.5 font-medium">
                        <div className="flex items-center gap-1">
                          <span className="min-w-0 truncate font-mono text-foreground">{column.name}</span>
                          <Badge variant="secondary">{TYPE_LABEL[column.type]}</Badge>
                          <ColumnMenu
                            column={column}
                            first={c === 0}
                            last={c === columns.length - 1}
                            only={columns.length === 1}
                            onEdit={() => setEditing(c)}
                            onMove={(by) => moveColumn(c, c + by)}
                            onDelete={() => deleteColumn(c)}
                          />
                        </div>
                      </th>
                    ))
                  : [0, 1].map((c) => (
                      <th key={c} className="px-3 py-2 font-medium">
                        <span className="sr-only">Loading</span>
                      </th>
                    ))}
                <th className="w-0 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!table && <SkeletonRows widths={['w-6', 'w-32', 'w-48', 'w-8']} />}
              {table && rows.length === 0 && (
                <TableEmpty
                  colSpan={columns.length + 2}
                  icon={Table2Icon}
                  title="No rows yet"
                  description="Add rows here, or import a CSV file or cells copied from a spreadsheet."
                />
              )}
              {table && rows.length > 0 && shown.length === 0 && (
                <tr className="border-t">
                  <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-muted-foreground">
                    No row holds {filter.trim()}.
                  </td>
                </tr>
              )}
              {table &&
                pageRows.map((r) => (
                  <tr key={r} className="border-t">
                    <td className="tabular px-3 py-1 text-right text-muted-foreground text-xs">{r + 1}</td>
                    {columns.map((column, c) => {
                      const wrong = badSet.has(`${r}:${c}`);
                      return (
                        <td key={c} className="px-1 py-1">
                          <Input
                            value={rows[r]![c] ?? ''}
                            onChange={(event) => setCell(r, c, event.target.value)}
                            data-cell={`${r}:${c}`}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey)) {
                                event.preventDefault();
                                moveFocus(r, c, 1);
                              } else if (event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)) {
                                event.preventDefault();
                                moveFocus(r, c, -1);
                              }
                            }}
                            onPaste={(event) => {
                              const text = event.clipboardData.getData('text/plain');
                              if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
                              event.preventDefault();
                              pasteBlock(r, c, text);
                            }}
                            aria-label={`Row ${r + 1}, ${column.name}`}
                            aria-invalid={wrong}
                            title={wrong ? `Takes ${column.type === 'number' ? 'a number' : 'a date, such as 2026-10-15'}` : undefined}
                            spellCheck={false}
                            className={cn('h-8 font-mono text-xs', column.type === 'number' && 'text-right tabular-nums')}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">
                      <Hint text="Delete the row. Nothing is saved until you save.">
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete row ${r + 1}`} onClick={() => deleteRow(r)}>
                          <XIcon />
                        </Button>
                      </Hint>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <nav aria-label="Pages of rows" className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">
              Rows {(current * PAGE_ROWS + 1).toLocaleString('en-US')} to {Math.min((current + 1) * PAGE_ROWS, shown.length).toLocaleString('en-US')} of{' '}
              {shown.length.toLocaleString('en-US')}
            </span>
            <Hint text="Previous page">
              <Button variant="outline" size="icon-sm" aria-label="Previous page" onClick={() => setPage(current - 1)} disabled={current === 0}>
                <ChevronLeftIcon />
              </Button>
            </Hint>
            <Hint text="Next page">
              <Button variant="outline" size="icon-sm" aria-label="Next page" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
                <ChevronRightIcon />
              </Button>
            </Hint>
          </nav>
        )}
      </div>

      {editing !== null && (
        <ColumnDialog
          column={editing === 'new' ? { name: newColumnName(columns), type: 'string' } : columns[editing]!}
          isNew={editing === 'new'}
          taken={columns.filter((_, i) => i !== editing).map((c) => c.name)}
          onClose={() => setEditing(null)}
          onSave={(next) => saveColumn(editing, next)}
        />
      )}

      {importing && table && <ImportDialog name={table.name} keep={columns} onClose={() => setImporting(false)} onImport={importCsv} />}

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                pending?.run();
                setPending(null);
              }}
            >
              {pending?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!leaving} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>The changes to {name} since you last saved are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const href = leaving;
                setDirty(false);
                setLeaving(null);
                if (href) router.push(href);
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/** The menu of a column: rename and retype, move, delete. */
function ColumnMenu({
  column,
  first,
  last,
  only,
  onEdit,
  onMove,
  onDelete,
}: {
  column: EditColumn;
  first: boolean;
  last: boolean;
  only: boolean;
  onEdit(): void;
  onMove(by: -1 | 1): void;
  onDelete(): void;
}) {
  return (
    <DropdownMenu>
      <Hint text="Rename, retype, move or delete the column">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for column ${column.name}`} className="ml-auto">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon />
          Rename or retype
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(-1)} disabled={first}>
          <ArrowLeftIcon />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(1)} disabled={last}>
          <ArrowRightIcon />
          Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={only}>
          <Trash2Icon />
          Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Name a column and pick its type. A cell that does not fit the type is marked in the grid. */
function ColumnDialog({
  column,
  isNew,
  taken,
  onClose,
  onSave,
}: {
  column: LookupTableColumn;
  isNew: boolean;
  taken: readonly string[];
  onClose(): void;
  onSave(column: LookupTableColumn): void;
}) {
  const [name, setName] = useState(column.name);
  const [type, setType] = useState(column.type);
  const trimmed = name.trim();
  const problem = !trimmed
    ? 'Give the column a name.'
    : !LOOKUP_NAME.test(trimmed)
      ? 'Use letters, digits and underscores, starting with a letter, so templates can read it.'
      : taken.includes(trimmed)
        ? `There is already a column named ${trimmed}.`
        : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!problem) onSave({ name: trimmed, type });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add column' : `Column ${column.name}`}</DialogTitle>
          <DialogDescription>Templates write the name, such as {`{d.pg.terms.${trimmed && LOOKUP_NAME.test(trimmed) ? trimmed : 'TEXT'}}`}.</DialogDescription>
        </DialogHeader>
        <form id="column-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="column-name">Name</Label>
            <Input
              id="column-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!problem}
              aria-describedby="column-name-problem"
              className="font-mono"
            />
            {problem && (
              <p id="column-name-problem" className="text-destructive text-xs">
                {problem}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="column-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as LookupTableColumn['type'])}>
              <SelectTrigger id="column-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date, YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Hint text={problem}>
            <Button type="submit" form="column-form" disabled={!!problem}>
              {isNew ? 'Add column' : 'Done'}
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read a CSV file or pasted cells, preview them, and replace the table's columns and rows with them. */
function ImportDialog({ name, keep, onClose, onImport }: { name: string; keep: readonly LookupTableColumn[]; onClose(): void; onImport(table: CsvTable): void }) {
  const [csv, setCsv] = useState<CsvTable | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import CSV into {name}</DialogTitle>
          <DialogDescription>
            The columns and rows of the CSV replace those of the table. A column the table has keeps its type. Nothing is saved until you save.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          <CsvInput id="import-csv" keep={keep} onParsed={setCsv} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Hint text={csv ? undefined : 'Choose a CSV file or paste the cells first.'}>
            <Button onClick={() => csv && onImport(csv)} disabled={!csv}>
              Replace rows
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

