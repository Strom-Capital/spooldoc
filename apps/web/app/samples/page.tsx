import type { Metadata } from 'next';
import Link from 'next/link';
import { listSamples } from '@/lib/server/samples';

export const metadata: Metadata = { title: 'Samples · Spooldoc' };
export const dynamic = 'force-dynamic';

/** Captured samples in the workspace. */
export default async function SamplesPage() {
  const { samples, error } = await listSamples().then(
    (rows) => ({ samples: rows, error: null }),
    (err: unknown) => ({ samples: [], error: err instanceof Error ? err.message : 'The workspace could not be read.' }),
  );
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1 className="font-semibold text-2xl tracking-tight">Samples</h1>
      <p className="mt-1 mb-6 text-muted-foreground text-sm">
        Captured spooled files in the workspace. Open one in the workbench to define its documents.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Sample</th>
              <th className="px-3 py-2 font-medium">Spooled file</th>
              <th className="px-3 py-2 font-medium">Queue</th>
              <th className="px-3 py-2 text-right font-medium">Pages</th>
              <th className="px-3 py-2 text-right font-medium">Code page</th>
              <th className="px-3 py-2 font-medium">Definition</th>
              <th className="px-3 py-2 font-medium">Captured</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr key={sample.id} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/samples/${encodeURIComponent(sample.id)}`}
                    className="font-medium font-mono text-primary text-xs hover:underline"
                  >
                    {sample.id}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {sample.splf.name} #{sample.splf.number}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {sample.queue.library}/{sample.queue.name}
                </td>
                <td className="tabular px-3 py-2 text-right">{sample.pages}</td>
                <td className="tabular px-3 py-2 text-right">{sample.codePage}</td>
                <td className="px-3 py-2">
                  {sample.definition ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary text-xs">{sample.definition}</span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="tabular whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {sample.capturedAt.replace('T', ' ').replace('Z', ' UTC')}
                </td>
              </tr>
            ))}
            {samples.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No samples yet. Connect, pick a queue and capture a spooled file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
