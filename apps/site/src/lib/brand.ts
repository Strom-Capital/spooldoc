/**
 * Prepares one of the app's brand SVGs (apps/web/public/brand) to sit inline in a page:
 * its ids get a prefix so two logos on one page do not share a mask, its own size goes
 * so CSS sizes it, and it is hidden from screen readers, as the link around it names it.
 */
export function inlineSvg(svg: string, prefix: string, className: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/<svg\b([^>]*)>/, (_, attributes: string) => {
      const kept = attributes.replace(/\s(?:width|height|role|aria-label)="[^"]*"/g, '');
      return `<svg${kept} class="${className}" aria-hidden="true" focusable="false">`;
    });
}

/** An SVG as a `data:` URL, for a favicon. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}
