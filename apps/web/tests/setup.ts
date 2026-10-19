import { afterAll, beforeEach } from 'vitest';
import { setDb } from '@/lib/server/db';
import { setDocumentRenderer } from '@/lib/server/documents';
import { fakeCarbone, fakeRenderer } from './helpers/carbone';
import { openTestDb } from './helpers/db';

// Every test file gets its own migrated database and known secrets.
process.env.BETTER_AUTH_SECRET = 'test-auth-secret-that-is-at-least-32-characters';
process.env.SPOOLDOC_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL = 'http://localhost:3000';
process.env.SPOOLDOC_WATCHER = 'off';
// Tests that check the log turn it on and catch the lines with `setLogSink`.
process.env.SPOOLDOC_LOG_LEVEL = 'off';
delete process.env.DATABASE_URL;
delete process.env.SPOOLDOC_ALLOWED_HOSTS;

// Documents render with a stand-in for Carbone; see helpers/carbone.ts.
setDocumentRenderer(fakeRenderer);
beforeEach(() => {
  fakeCarbone.mockClear();
});

const testDb = await openTestDb();
setDb(testDb);
(globalThis as { __testDb?: typeof testDb }).__testDb = testDb;

afterAll(async () => {
  setDb(undefined);
  await testDb.close();
});
