'use client';

import type { CsvTable } from '@spooldoc/core/csv';
import { LOOKUP_TABLE_NAME } from '@spooldoc/core/lookups';
import { DownloadIcon, PencilIcon, PlusIcon, Table2Icon, TextCursorInputIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { Hint } from '@/components/hint';
import { JobsPopover } from '@/components/jobs-popover';
import { ErrorNote, Page } from '@/components/page';
import { ActionsCell, ActionsHead, RowAction, RowMenu, useRowOpen } from '@/components/row-actions';
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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { ago } from '@/lib/client/format';
import { downloadCsv, jobNames } from '@/lib/client/lookup-tables';
import type { LookupTableSummary, LookupTableView } from '@/lib/types';
import { CsvInput } from './lookup-table-csv';

const NAME_RULE = 'Lowercase letters, digits, dashes and underscores, starting with a letter or digit. Lookups pick the table by it.';

/** The columns a table started empty has. */
const STARTER_COLUMNS = [
  { name: 'CODE', type: 'string' as const },
  { name: 'TEXT', type: 'string' as const },
];

/** Lookup tables kept in Spooldoc: the list, with the jobs that read each, and new, rename and delete. */
export function LookupTablesPage() {
  const [tables, setTables] = useState<LookupTableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<LookupTableSummary | null>(null);
  const [deleting, setDeleting] = useState<LookupTableSummary | null>(null);
  const rowOpen = useRowOpen();

  const load = useCallback(async () => {
    try {
      setTables((await api<{ tables: LookupTableSummary[] }>('/api/lookup-tables')).tables);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    api<{ tables: LookupTableSummary[] }>('/api/lookup-tables').then(
      (data) => setTables(data.tables),
      (err) => setError(errorText(err)),
    );
  }, []);

  async function remove(table: LookupTableSummary) {
    try {
      await api(`/api/lookup-tables/${table.id}`, { method: 'DELETE' });
      setDeleting(null);
      toast.success(`Deleted ${table.name}`);
      await load();
    } catch (err) {
      setDeleting(null);
      toast.error(`Could not delete ${table.name}`, { description: errorText(err) });
    }
  }

  return (
    <Page
      title="Lookup tables"
      description="Values a document needs that are not in Db2 for i, such as the text of a payment terms code. A lookup in a job matches rows of a table, with no SQL."
      actions={
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          New table
        </Button>
      }
    >
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {tables === null && !error && <Loading>Loading lookup tables...</Loading>}
      {tables?.length === 0 && (
        <EmptyState
          icon={Table2Icon}
          title="No lookup tables yet"
          description="Make a table of codes and the text a document prints for them. Start empty, or from a CSV file or cells copied from a spreadsheet."
        >
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            New table
          </Button>
        </EmptyState>
      )}
      {tables && tables.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Table</th>
                <th className="px-3 py-2 font-medium">Columns</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <th className="px-3 py-2 font-medium">Changed</th>
                <ActionsHead />
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => {
                const href = `/lookup-tables/${table.id}`;
                return (
                  <tr key={table.id} {...rowOpen(href, 'border-t align-top')}>
                    <td className="px-3 py-2.5">
                      <Link href={href} className="rounded-sm font-medium font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {table.name}
                      </Link>
                    </td>
                    <td className="max-w-80 px-3 py-2.5">
                      <span className="line-clamp-2 break-words font-mono text-muted-foreground text-xs" title={table.columns.map((c) => c.name).join(', ')}>
                        {table.columns.map((c) => c.name).join(', ')}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{table.rows.toLocaleString('en-US')}</td>
                    <td className="tabular px-3 py-2.5 text-right">
                      <JobsPopover
                        jobs={table.jobs}
                        label={`${table.jobs.length} ${table.jobs.length === 1 ? 'job reads' : 'jobs read'} ${table.name}`}
                        heading="Jobs with a lookup that reads it"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground" title={table.updatedAt}>
                      {ago(table.updatedAt)}
                    </td>
                    <ActionsCell>
                      <RowAction asChild>
                        <Link href={href}>
                          <PencilIcon />
                          Open
                        </Link>
                      </RowAction>
                      <RowAction onClick={() => void downloadCsv(table)}>
                        <DownloadIcon />
                        Download CSV
                      </RowAction>
                      <RowMenu label={table.name}>
                        <DropdownMenuItem asChild>
                          <Link href={href}>
                            <PencilIcon />
                            Open
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void downloadCsv(table)}>
                          <DownloadIcon />
                          Download CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRenaming(table)}>
                          <TextCursorInputIcon />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(table)}>
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </RowMenu>
                    </ActionsCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && <NewTableDialog onClose={() => setAdding(false)} />}

      {renaming && (
        <RenameDialog
          table={renaming}
          onClose={() => setRenaming(null)}
          onSaved={async (saved) => {
            toast.success(`Renamed ${renaming.name} to ${saved.name}`);
            setRenaming(null);
            await load();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.jobs.length > 0
                ? `${jobNames(deleting.jobs)} ${deleting.jobs.length === 1 ? 'has a lookup that reads' : 'have lookups that read'} it. ${deleting.jobs.length === 1 ? 'Its' : 'Their'} runs stop at the Lookups step until another table is picked. This cannot be undone.`
                : 'No job reads it. This cannot be undone. Download it as CSV first to keep a copy.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove(deleting)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/** Name a new table, and start it empty or from a CSV. Opens the table once it is made. */
function NewTableDialog({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState<'empty' | 'csv'>('empty');
  const [csv, setCsv] = useState<CsvTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const nameOk = LOOKUP_TABLE_NAME.test(name.trim());

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameOk || (start === 'csv' && !csv)) return;
    setBusy(true);
    setError(null);
    try {
      const body = start === 'csv' && csv ? { name: name.trim(), columns: csv.columns, rows: csv.rows } : { name: name.trim(), columns: STARTER_COLUMNS, rows: [] };
      const made = await api<LookupTableView>('/api/lookup-tables', { method: 'POST', body });
      toast.success(`Added ${made.name}`);
      router.push(`/lookup-tables/${made.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const why = !nameOk ? 'Name the table first.' : start === 'csv' && !csv ? 'Choose a CSV file or paste the cells first.' : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New lookup table</DialogTitle>
          <DialogDescription>Up to 10,000 rows and 50 columns. Each column is text, a number or a date.</DialogDescription>
        </DialogHeader>
        <form id="new-table-form" onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-name">Name</Label>
            <Input
              id="table-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="payment-terms"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!name && !nameOk}
              aria-describedby="table-name-rule"
              className="font-mono"
            />
            <p id="table-name-rule" className="text-muted-foreground text-xs">
              {NAME_RULE}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-start">Start</Label>
            <Select value={start} onValueChange={(value) => setStart(value as 'empty' | 'csv')}>
              <SelectTrigger id="table-start" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="empty">Empty, with the columns CODE and TEXT</SelectItem>
                <SelectItem value="csv">From a CSV file or pasted cells</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {start === 'csv' && <CsvInput id="new-table-csv" onParsed={setCsv} />}
          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Hint text={why}>
            <Button type="submit" form="new-table-form" disabled={busy || !!why}>
              {busy && <Spinner />}
              Add table
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Give a table a new name. Lookups pick a table by its id, so they keep reading it. */
function RenameDialog({ table, onClose, onSaved }: { table: LookupTableSummary; onClose(): void; onSaved(saved: LookupTableView): void }) {
  const [name, setName] = useState(table.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOk = LOOKUP_TABLE_NAME.test(name.trim());

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameOk) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<LookupTableView>(`/api/lookup-tables/${table.id}`, { method: 'PATCH', body: { revision: table.revision, name: name.trim() } }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {table.name}</DialogTitle>
          <DialogDescription>Lookups keep reading it under its new name.</DialogDescription>
        </DialogHeader>
        <form id="rename-table-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-table-name">Name</Label>
            <Input
              id="rename-table-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!name && !nameOk}
              aria-describedby="rename-table-rule"
              className="font-mono"
            />
            <p id="rename-table-rule" className="text-muted-foreground text-xs">
              {NAME_RULE}
            </p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="rename-table-form" disabled={busy || !nameOk || name.trim() === table.name}>
            {busy && <Spinner />}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
