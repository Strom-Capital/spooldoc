/**
 * Runs once when the server starts: applies the database migrations, starts checking the
 * Carbone connection every few minutes and checking for alerts every 30 seconds (in every
 * instance; a lock lets one check at a time), then starts the queue watcher.
 * SPOOLDOC_MIGRATE=off skips the migrations (run `pnpm db:migrate` instead);
 * SPOOLDOC_WATCHER=off leaves watching to another instance.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { getConfig, retiredSettings } = await import('./lib/server/config');
  const config = getConfig();
  const { log } = await import('./lib/server/log');
  for (const message of retiredSettings()) {
    log.warn(message);
  }
  if (process.env.SPOOLDOC_MIGRATE !== 'off') {
    const { runMigrations } = await import('./lib/server/db');
    await runMigrations();
  }
  const { startRenderingChecks } = await import('./lib/server/rendering');
  startRenderingChecks();
  const { startAlerts } = await import('./lib/server/alerts');
  startAlerts();
  if (config.watcher) {
    const { startWatcher } = await import('./lib/server/watcher');
    startWatcher();
  }
}
