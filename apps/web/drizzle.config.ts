import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not read .env files itself.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: DATABASE_URL comes from the environment.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
});
