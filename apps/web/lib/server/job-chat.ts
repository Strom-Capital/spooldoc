import 'server-only';

import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { jobChats } from './db/schema';

/**
 * The stored thread of a job's AI assistant: every message the chat panel shows, with
 * the tool calls and their results as the model saw them (masked when masking is on).
 * One thread per job, deleted with the job.
 */

/** The job's thread, or an empty list when it has none. */
export async function readChat(jobId: string): Promise<UIMessage[]> {
  const [row] = await getDb().select({ messages: jobChats.messages }).from(jobChats).where(eq(jobChats.jobId, jobId));
  return row?.messages ?? [];
}

/** Replace the job's thread. */
export async function saveChat(jobId: string, messages: UIMessage[]): Promise<void> {
  await getDb()
    .insert(jobChats)
    .values({ jobId, messages })
    .onConflictDoUpdate({ target: jobChats.jobId, set: { messages, updatedAt: new Date() } });
}

/** Forget the job's thread (New chat). */
export async function clearChat(jobId: string): Promise<void> {
  await getDb().delete(jobChats).where(eq(jobChats.jobId, jobId));
}
