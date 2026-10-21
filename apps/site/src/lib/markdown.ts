import { createMarkdownProcessor, type MarkdownRenderer } from '@astrojs/markdown-remark';
import { shikiConfig, syntaxHighlight } from './shiki';

let renderer: Promise<MarkdownRenderer> | undefined;

/**
 * Renders a guide with Astro's own Markdown pipeline: GitHub Flavored Markdown, raw
 * HTML, the site's Shiki themes and heading ids from github-slugger, as GitHub and
 * @spooldoc/docs give them. No smartypants, so the text reads as it does in the app.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  renderer ??= createMarkdownProcessor({
    smartypants: false,
    syntaxHighlight: { ...syntaxHighlight, excludeLangs: [...syntaxHighlight.excludeLangs] },
    shikiConfig: { ...shikiConfig, transformers: [...shikiConfig.transformers] },
  });
  const { code } = await (await renderer).render(markdown);
  return code;
}
