import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Blog posts: `src/content/blog/YYYY-MM-DD-slug.md`. A post can be about anything;
 * a release post carries the tag `release`.
 */
const blog = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/blog',
    // Drop the date prefix from the URL: 2026-10-21-introducing-spooldoc.md -> /blog/introducing-spooldoc
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
