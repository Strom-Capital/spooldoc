'use client';

import { csvToTable, delimiterName, type CsvTable } from '@spooldoc/core/csv';
import type { LookupTableColumn } from '@spooldoc/core/lookups';
import { useState } from 'react';
import { ErrorNote } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cellText, decodeCsv, TYPE_LABEL } from '@/lib/client/lookup-tables';
import { cn } from '@/lib/utils';

/** Rows the preview shows. */
const PREVIEW_ROWS = 5;

/** How the CSV was read: "Semicolon delimited, with decimal commas." */
function readAs(table: CsvTable): string {
  const name = delimiterName(table.delimiter);
  return `${name[0]!.toUpperCase()}${name.slice(1)} delimited${table.decimalComma ? ', with decimal commas' : ''}.`;
}

/**
 * A CSV to read as a lookup table, from a file or pasted cells, with a preview of what
 * was read: the delimiter, each column and its type, and the first rows. The first row
 * names the columns. A column named in `keep` keeps its type.
 */
export function CsvInput({ id, keep = [], onParsed }: { id: string; keep?: readonly LookupTableColumn[]; onParsed(table: CsvTable | null): void }) {
  const [text, setText] = useState('');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  function read(next: string, fromFile = false) {
    if (!fromFile) setFallback(false);
    setText(next);
    if (!next.trim()) {
      setTable(null);
      setError(null);
      onParsed(null);
      return;
    }
    try {
      const parsed = csvToTable(next, keep);
      setTable(parsed);
      setError(null);
      onParsed(parsed);
    } catch (err) {
      setTable(null);
      setError(err instanceof Error ? err.message : String(err));
      onParsed(null);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    try {
      const decoded = decodeCsv(await file.arrayBuffer());
      setFallback(decoded.fallback);
      read(decoded.text, true);
    } catch {
      setError(`Could not read ${file.name}. Save it as CSV and choose it again.`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-file`}>CSV file</Label>
        <Input
          id={`${id}-file`}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => {
            void readFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-text`}>Or paste the cells</Label>
        <Textarea
          id={`${id}-text`}
          value={text}
          onChange={(event) => read(event.target.value)}
          placeholder={'CODE;TEXT\n14;Net 14 days'}
          spellCheck={false}
          className="h-28 font-mono text-xs"
        />
        <p className="text-muted-foreground text-xs">
          The first row names the columns. Commas, semicolons and tabs work, so cells copied from a spreadsheet can be pasted. With semicolons
          or tabs, numbers take a decimal comma; with commas, a decimal point.
        </p>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {table && (
        <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-2">
          <h3 id={`${id}-preview`} className="font-medium text-sm">
            {table.rows.length.toLocaleString('en-US')} {table.rows.length === 1 ? 'row' : 'rows'}, {table.columns.length}{' '}
            {table.columns.length === 1 ? 'column' : 'columns'}
          </h3>
          <p className="text-muted-foreground text-xs">
            {readAs(table)}
            {fallback && ' Read as Windows-1252, not UTF-8.'}
            {table.emptyRows > 0 && ` ${table.emptyRows.toLocaleString('en-US')} ${table.emptyRows === 1 ? 'row' : 'rows'} with every cell empty left out.`}
          </p>
          {table.misfits > 0 && (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              {table.misfits.toLocaleString('en-US')} {table.misfits === 1 ? 'cell does' : 'cells do'} not fit the type {table.misfits === 1 ? 'its column keeps' : 'their columns keep'}.
              The grid marks them, and they need fixing before you save.
            </p>
          )}
          <div className="max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.name} scope="col" className="px-2 py-1 text-left font-medium">
                      <span className="font-mono">{column.name}</span>{' '}
                      <Badge variant="secondary" className="ml-1">
                        {TYPE_LABEL[column.type]}
                      </Badge>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {table.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className={cn('px-2 py-1 font-mono', table.columns[c]?.type === 'number' && 'text-right tabular-nums')}>
                        {cellText(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.rows.length > PREVIEW_ROWS && (
            <p className="text-muted-foreground text-xs">
              The first {PREVIEW_ROWS} of {table.rows.length.toLocaleString('en-US')} rows.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
