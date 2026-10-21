'use client';

import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { cn } from 'cn';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import rehypeSlug from 'rehype-slug';
import { type Components, defaultRehypePlugins, type ExtraProps, Streamdown, type StreamdownProps } from 'streamdown';

const plugins = { code, mermaid };

type Pluggable = NonNullable<StreamdownProps['rehypePlugins']>[number];

const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, { attributes: Record<string, string[]> }];

/**
 * Streamdown's own plugins, with images allowed a class so a screenshot can follow the
 * theme, and then GitHub's heading anchors, so `#anchor` links from the guides land.
 */
const rehypePlugins: Pluggable[] = [
  defaultRehypePlugins.raw!,
  [sanitize, { ...schema, attributes: { ...schema.attributes, img: [...(schema.attributes.img ?? []), 'className', 'width', 'height'] } }] as Pluggable,
  defaultRehypePlugins.harden!,
  rehypeSlug,
];

const linkClass = 'wrap-anywhere font-medium text-primary underline';

/** Links to other guides stay in the app; links away from it open in a new tab. */
function DocsAnchor({ href = '', children, className, ...props }: ComponentProps<'a'> & ExtraProps) {
  // The Markdown node Streamdown passes along is not an attribute.
  delete props.node;
  if (href.startsWith('/docs')) {
    return (
      <Link href={href} className={cn(linkClass, className)} {...props}>
        {children}
      </Link>
    );
  }
  if (href.startsWith('#')) {
    return (
      <a href={href} className={cn(linkClass, className)} {...props}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(linkClass, className)} {...props}>
      {children}
    </a>
  );
}

function DocsImage({ className, alt = '', ...props }: ComponentProps<'img'> & ExtraProps) {
  delete props.node;
  // eslint-disable-next-line @next/next/no-img-element -- a screenshot from docs/assets, served as it is
  return <img alt={alt} className={cn('h-auto max-w-full rounded-md border', className)} {...props} />;
}

const components: Components = { a: DocsAnchor, img: DocsImage };

/** A guide from docs/, rendered like the agent's answers, with room to read. */
export function DocsMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      mode="static"
      className={cn(
        // Inline code wraps anywhere, so a long tag never widens a phone screen; code blocks scroll in themselves.
        // Streamdown lays out an off-screen code block as a 200px box (content-visibility: auto) until it
        // scrolls near, which moves every heading below it. Here each block has its real height from the start.
        'text-[15px] leading-7 [&_:not(pre)>code]:wrap-anywhere [&_[data-streamdown=code-block]]:[content-visibility:visible]! [&_:is(h2,h3,h4)]:scroll-mt-20 [&_h2]:mt-10 [&_h3]:mt-8 [&_p]:my-3',
        className,
      )}
      plugins={plugins}
      rehypePlugins={rehypePlugins}
      components={components}
      linkSafety={{ enabled: false }}
      controls={{ table: false, code: true, mermaid: true }}
      tableMaxHeight={0}
      codeBlockMaxHeight={0}
    >
      {children}
    </Streamdown>
  );
}
