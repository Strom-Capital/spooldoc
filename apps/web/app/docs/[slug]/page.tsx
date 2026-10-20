import type { Metadata } from 'next';
import { DocsMarkdown } from '@/components/docs/docs-markdown';
import { docsNav, docsPage } from '@/lib/server/docs';

// Only the guides listed in docs/README.md; any other address is a 404.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return docsNav().flatMap(({ pages }) => pages.map(({ slug }) => ({ slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = docsPage((await params).slug);
  return { title: page.title, description: page.description };
}

/** One guide, with its sections listed on the right on wide screens. */
export default async function DocsGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const page = docsPage((await params).slug);
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-4 py-8 sm:px-8 sm:py-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <h1 className="font-semibold text-3xl tracking-tight">{page.title}</h1>
        <p className="mt-2 mb-8 text-lg text-muted-foreground">{page.description}</p>
        <DocsMarkdown>{page.markdown}</DocsMarkdown>
      </article>
      {page.headings.length > 0 && (
        <nav aria-label="On this page" className="sticky top-8 hidden max-h-[calc(100svh-4rem)] w-56 shrink-0 self-start overflow-y-auto xl:block">
          <p className="mb-2 font-medium text-sm">On this page</p>
          <ul className="space-y-1.5 text-sm">
            {page.headings.map((heading) => (
              <li key={heading.id} className={heading.depth === 3 ? 'pl-3' : undefined}>
                <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
