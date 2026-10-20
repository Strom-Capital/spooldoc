import Link from 'next/link';
import { docsNav } from '@/lib/server/docs';

/** Every guide in its group, with what it covers. */
export default function DocsIndexPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
      <h1 className="font-semibold text-3xl tracking-tight">Documentation</h1>
      <p className="mt-2 text-lg text-muted-foreground">Install, use and run Spooldoc.</p>
      {docsNav().map(({ group, pages }) => (
        <section key={group} className="mt-10">
          <h2 className="mb-3 font-semibold text-lg">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pages.map((page) => (
              <Link
                key={page.slug}
                href={`/docs/${page.slug}`}
                className="rounded-lg border p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="font-medium">{page.title}</div>
                <p className="mt-1 text-muted-foreground text-sm">{page.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
