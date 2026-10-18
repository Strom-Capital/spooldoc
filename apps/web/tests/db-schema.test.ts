import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { destinations, jobs, jobVersions, runs, settings, watchSeen } from '@/lib/server/db/schema';
import { resetTables } from './helpers/db';
import { builtinDestination, db, insertJob, insertServer } from './helpers/fixtures';

const splf = { name: 'SPDINVOICE', number: 1, jobName: 'QPADEV0001', jobUser: 'DEMOUSER', jobNumber: '123456' };

describe('database rules', () => {
  beforeEach(() => resetTables(db()));

  it('seeds the Spooldoc destination and the settings row', async () => {
    const rows = await db().select().from(destinations);
    expect(rows).toEqual([expect.objectContaining({ kind: 'spooldoc', name: 'Spooldoc download', builtin: true })]);
    expect(
      await db().select({ poll: settings.pollSeconds, safety: settings.safetyCheckSeconds, retention: settings.retentionDays }).from(settings),
    ).toEqual([{ poll: 30, safety: 300, retention: 90 }]);
  });

  it('refuses settings outside the ranges and a second settings row', async () => {
    await expect(db().update(settings).set({ pollSeconds: 1 })).rejects.toThrow();
    await expect(db().update(settings).set({ safetyCheckSeconds: 10 })).rejects.toThrow();
    await expect(db().update(settings).set({ retentionDays: 0 })).rejects.toThrow();
    await expect(db().update(settings).set({ retentionDays: 3651 })).rejects.toThrow();
    await expect(db().insert(settings).values({ id: 2 })).rejects.toThrow();
  });

  it('never changes or deletes a saved version', async () => {
    const jobId = await insertJob(await insertServer());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    await db().insert(jobVersions).values({ jobId, number: 1, spec: job!.draft });

    const refused = { cause: expect.objectContaining({ message: expect.stringMatching(/cannot be changed/) }) };
    await expect(db().update(jobVersions).set({ note: 'changed' })).rejects.toMatchObject(refused);
    await expect(db().delete(jobVersions).where(eq(jobVersions.jobId, jobId))).rejects.toMatchObject(refused);
    expect(await db().select().from(jobVersions)).toHaveLength(1);
  });

  it('removes versions, runs and seen files with their job', async () => {
    const jobId = await insertJob(await insertServer());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    await db().insert(jobVersions).values({ jobId, number: 1, spec: job!.draft });
    const [run] = await db().insert(runs).values({ jobId, version: 1, trigger: 'manual', splf }).returning();
    await db().insert(watchSeen).values({ jobId, splfKey: 'k', runId: run!.id });

    await db().delete(jobs).where(eq(jobs.id, jobId));

    expect(await db().select().from(jobVersions)).toEqual([]);
    expect(await db().select().from(runs)).toEqual([]);
    expect(await db().select().from(watchSeen)).toEqual([]);
  });

  it('records a spooled file only once per job', async () => {
    const jobId = await insertJob(await insertServer());
    await db().insert(watchSeen).values({ jobId, splfKey: 'k' });
    await expect(db().insert(watchSeen).values({ jobId, splfKey: 'k' })).rejects.toThrow();
    const inserted = await db().insert(watchSeen).values({ jobId, splfKey: 'k' }).onConflictDoNothing().returning();
    expect(inserted).toEqual([]);
  });

  it('checks run triggers and statuses', async () => {
    const jobId = await insertJob(await insertServer());
    await expect(db().insert(runs).values({ jobId, version: 1, trigger: 'cron', splf })).rejects.toThrow();
    await expect(db().insert(runs).values({ jobId, version: 1, trigger: 'watch', splf, status: 'done' })).rejects.toThrow();
    const [run] = await db().insert(runs).values({ jobId, version: 1, trigger: 'watch', splf }).returning();
    expect(run).toMatchObject({ status: 'running', steps: [] });
    expect(run!.seq).toBeGreaterThan(0);
  });

  it('refuses unknown destination kinds', async () => {
    await expect(db().insert(destinations).values({ kind: 'ftp', name: 'x' })).rejects.toThrow();
    expect(await builtinDestination()).toBeTruthy();
    await db().execute(sql`select 1`);
  });
});
