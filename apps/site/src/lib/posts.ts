import { getCollection, type CollectionEntry } from 'astro:content';
import { sortPosts } from './sortPosts';

export type Post = CollectionEntry<'blog'>;

/** Published posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  return sortPosts(await getCollection('blog', ({ data }) => !data.draft));
}
