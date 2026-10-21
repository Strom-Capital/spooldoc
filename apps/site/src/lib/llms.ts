import type { DocsGroup } from '@spooldoc/docs';
import { FEATURES } from './features';
import { docsUrl, links, url } from './links';
import type { PostLike } from './sortPosts';

/**
 * /llms.txt, per https://llmstxt.org: what Spooldoc is, with a link to every guide, the
 * features page and the blog.
 */
export function llmsTxt({ site, nav, posts, version }: { site: URL; nav: DocsGroup[]; posts: PostLike[]; version: string }): string {
  const abs = (path: string) => new URL(url(path), site).href;
  const docs = nav
    .map(({ group, pages }) => `### ${group}\n\n${pages.map((page) => `- [${page.title}](${abs(docsUrl(page.slug))}): ${page.description}`).join('\n')}`)
    .join('\n\n');
  const features = FEATURES.map((feature) => `- [${feature.title}](${abs(`/features/#${feature.id}`)}): ${feature.summary}`).join('\n');
  const blog = posts.length
    ? posts.map((post) => `- [${post.data.title}](${abs(`/blog/${post.id}/`)}): ${post.data.description}`).join('\n')
    : '- No posts yet.';

  return `# Spooldoc

> Spooled files into documents, for IBM i. Open output management. Spooldoc watches the output queues of an IBM i, splits each spooled file into page groups and reads each into JSON with a definition written in YAML, makes documents of them with HTML, Word or Excel templates, and delivers the files. Every run is logged.

- Open source under the MIT license, by Ström Capital Oy. Source: ${links.github}
- Latest release: ${version}. Release notes: ${links.releases}
- Runs as a container image, \`ghcr.io/strom-capital/spooldoc\`, on amd64 and arm64, with Postgres and a Carbone server for rendering. One Compose file starts all three.
- Connects to the IBM i through jt400 on the host server ports. Nothing is installed on the IBM i.
- Output: PDF, HTML, DOCX and XLSX. Destinations: Spooldoc download and a folder in the IFS.
- The agent in the job builder proposes the definition and the template from a sample spooled file, with Anthropic, Google, OpenAI, OpenRouter, Vercel AI Gateway or a local model. Spooldoc works without a model.

## Site

- [Home](${abs('/')}): what Spooldoc does, with screenshots and the architecture
- [Features](${abs('/features/')}): each feature in depth
- [Docs](${abs(docsUrl())}): the guides, the same files the app shows
- [Blog](${abs('/blog/')}): posts and release notes (RSS: ${abs('/rss.xml')})

## Features

${features}

## Docs

${docs}

## Blog posts

${blog}

## Optional

- [GitHub repository](${links.github}): source, issues and discussions
- [Releases](${links.releases})
- [Discussions](${links.discussions})
`;
}
