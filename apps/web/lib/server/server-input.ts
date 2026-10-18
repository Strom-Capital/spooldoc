import 'server-only';

import { z } from 'zod';
import { ibmiName } from '@/lib/job-spec';

/** Libraries of a server: IBM i names, upper-cased, without duplicates. */
export const librariesSchema = z
  .array(ibmiName)
  .max(50, 'Use at most 50 libraries')
  .transform((names) => [...new Set(names)]);

/** Fields of the add and edit server forms. */
export const serverFields = {
  name: z.string().trim().min(1, 'Enter a name').max(80),
  host: z.string().trim().min(1, 'Enter the host').max(255),
  user: z
    .string()
    .trim()
    .min(1, 'Enter the user profile')
    .max(10, 'A user profile has at most 10 characters')
    .transform((value) => value.toUpperCase()),
  password: z.string().min(1, 'Enter the password').max(128),
  libraries: librariesSchema,
};

export const createServerSchema = z.object({ ...serverFields, libraries: librariesSchema.default([]) });

export const updateServerSchema = z
  .object({
    ...serverFields,
    dataQueue: z.object({ library: ibmiName, name: ibmiName }).nullable(),
  })
  .partial();
