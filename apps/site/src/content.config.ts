import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Blog posts: `src/content/blog/YYYY-MM-DD-slug.md`. A post can be about anything;
 * a release post carries the tag `release`. Tags go to RSS categories and the JSON-LD
 * keywords; the pages show no tags.
 */
const blog = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/blog',
    // Drop the date prefix from the URL: 2026-10-21-spooldoc-0-3-0.md -> /blog/spooldoc-0-3-0
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    /** Where the post first appeared, such as a release's announcement in Discussions. */
    originalUrl: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
