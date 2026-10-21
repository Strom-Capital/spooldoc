import { describe, expect, it } from 'vitest';
import { rehypeImageLinks, zoomLabel } from '../src/lib/imageLinks';
import { renderMarkdown } from '../src/lib/markdown';

describe('rehypeImageLinks', () => {
  it('puts an image in a link to its file, marked for the viewer', async () => {
    const html = await renderMarkdown('![The Home page](/docs/assets/home-light.png)');
    expect(html).toContain('<a href="/docs/assets/home-light.png" data-zoom="" aria-label="Open the image full size: The Home page"><img src="/docs/assets/home-light.png" alt="The Home page"></a>');
  });

  it('gives each image of a light and dark pair its own link with the same theme', async () => {
    const html = await renderMarkdown(
      '<p align="center"><img data-theme-image="light" src="/docs/assets/a-light.png" alt="A page" width="900" height="563"><img data-theme-image="dark" src="/docs/assets/a-dark.png" alt="A page" width="900" height="563"></p>',
    );
    expect(html).toContain('<a href="/docs/assets/a-light.png" data-zoom="" aria-label="Open the image full size: A page" data-theme-image="light"><img data-theme-image="light"');
    expect(html).toContain('<a href="/docs/assets/a-dark.png" data-zoom="" aria-label="Open the image full size: A page" data-theme-image="dark"><img data-theme-image="dark"');
  });

  it('leaves an image in a link, and a decorative image, alone', async () => {
    const linked = await renderMarkdown('<a href="https://example.com"><img src="/badge.svg" alt="Badge"></a>');
    expect(linked).not.toContain('data-zoom');
    const decorative = await renderMarkdown('<img src="/docs/assets/line.png" alt="">');
    expect(decorative).not.toContain('data-zoom');
  });

  it('wraps the image in place in a hast tree', () => {
    const image = { type: 'element', tagName: 'img', properties: { src: '/a.png', alt: 'A' }, children: [] };
    const paragraph = { type: 'element', tagName: 'p', properties: {}, children: [image] };
    rehypeImageLinks()({ type: 'root', children: [paragraph] });
    expect(paragraph.children[0]).toEqual({
      type: 'element',
      tagName: 'a',
      properties: { href: '/a.png', dataZoom: '', ariaLabel: zoomLabel('A') },
      children: [image],
    });
  });
});
