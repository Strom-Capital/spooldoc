import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every test file gets its own empty workspace and a known session secret.
process.env.SESSION_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.APP_URL = 'http://localhost:3002';
process.env.SPOOLDOC_WORKSPACE = mkdtempSync(path.join(tmpdir(), 'spooldoc-web-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_COMPATIBLE_BASE_URL;
delete process.env.OPENAI_COMPATIBLE_MODEL;
delete process.env.SPOOLDOC_ALLOWED_HOSTS;
delete process.env.SPOOLDOC_CHROMIUM_PATH;
