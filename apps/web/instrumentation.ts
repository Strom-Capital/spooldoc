/**
 * Runs once when the server starts: applies the database migrations, then starts the
 * queue watcher. SPOOLDOC_MIGRATE=off skips the migrations (run `pnpm db:migrate`
 * instead); SPOOLDOC_WATCHER=off leaves watching to another instance.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { getConfig } = await import('./lib/server/config');
  const config = getConfig();
  if (process.env.SPOOLDOC_MIGRATE !== 'off') {
    const { runMigrations } = await import('./lib/server/db');
    await runMigrations();
  }
  if (config.watcher) {
    const { startWatcher } = await import('./lib/server/watcher');
    startWatcher();
  }
}
