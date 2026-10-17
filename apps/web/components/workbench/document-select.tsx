'use client';

import { useWorkbench } from './workbench-provider';

/** Picks the document shown in the JSON view and the HTML preview (shared). */
export function DocumentSelect() {
  const { render, documentIndex, setDocumentIndex } = useWorkbench();
  const documents = render?.extract?.documents ?? [];
  if (documents.length === 0) {
    return null;
  }
  return (
    <select
      value={Math.min(documentIndex, documents.length - 1)}
      onChange={(event) => setDocumentIndex(Number(event.target.value))}
      aria-label="Document"
      className="h-7 max-w-56 rounded-md border bg-background px-1.5 text-sm"
    >
      {documents.map((doc, index) => (
        <option key={index} value={index}>
          Document {index + 1} of {documents.length}
          {documentTitle(doc)}
        </option>
      ))}
    </select>
  );
}

/** The first short string value of a document, as a hint in the selector. */
function documentTitle(doc: Record<string, unknown>): string {
  for (const value of Object.values(doc)) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return `: ${String(value).trim().slice(0, 24)}`;
    }
  }
  return '';
}
