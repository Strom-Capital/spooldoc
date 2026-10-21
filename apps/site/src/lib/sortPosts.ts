/** What the site needs of a post, so the helpers work without Astro's content layer. */
export interface PostLike {
  id: string;
  filePath?: string;
  data: { title: string; description: string; date: Date; tags: string[]; originalUrl?: string };
}

/** Newest first. Posts on the same day are ordered by the time in `date`, then by file name. */
export function sortPosts<T extends PostLike>(posts: T[]): T[] {
  return [...posts].sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || (b.filePath ?? b.id).localeCompare(a.filePath ?? a.id));
}
