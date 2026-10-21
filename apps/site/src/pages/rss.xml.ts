import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../lib/posts';
import { url } from '../lib/links';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: 'Spooldoc blog',
    description: 'Posts and release notes from Spooldoc, open output management for IBM i.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: url(`/blog/${post.id}/`),
      categories: post.data.tags,
    })),
  });
}
