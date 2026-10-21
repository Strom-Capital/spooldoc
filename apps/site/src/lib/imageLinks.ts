/**
 * Screenshots and diagrams open full size when clicked. Each image sits in a link to its
 * own file, marked `data-zoom`; ImageViewer.astro turns the link into the viewer, and
 * without JavaScript the link still opens the image. Shot.astro and the landing page mark
 * their images themselves; the guides and posts get it from {@link rehypeImageLinks}.
 */

/** What a screen reader announces for the link around an image. */
export function zoomLabel(alt: string): string {
  return `Open the image full size: ${alt}`;
}

/** The part of a hast tree this plugin reads and writes. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * A rehype plugin that puts every image with alt text in a link to its file, marked for
 * the viewer. A light and dark pair (`data-theme-image`, see @spooldoc/docs) gets a link
 * each, carrying the same `data-theme-image`, so the theme CSS hides the link with its
 * image and the visible link points at the visible file. An image already in a link, or
 * with an empty alt (decorative), is left alone.
 *
 * Run it after rehype-raw: the guides' screenshots are raw HTML in the Markdown.
 */
export function rehypeImageLinks() {
  return (tree: HastNode) => {
    wrap(tree, false);
  };
}

function wrap(node: HastNode, inLink: boolean): void {
  const children = node.children;
  if (!children) return;
  for (const [index, child] of children.entries()) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'img' && !inLink) {
      const link = imageLink(child);
      if (link) children[index] = link;
    } else {
      wrap(child, inLink || child.tagName === 'a');
    }
  }
}

function imageLink(image: HastNode): HastNode | undefined {
  const { src, alt, dataThemeImage } = image.properties ?? {};
  if (typeof src !== 'string' || !src || typeof alt !== 'string' || !alt.trim()) return undefined;
  const properties: Record<string, unknown> = { href: src, dataZoom: '', ariaLabel: zoomLabel(alt) };
  if (typeof dataThemeImage === 'string') properties.dataThemeImage = dataThemeImage;
  return { type: 'element', tagName: 'a', properties, children: [image] };
}
