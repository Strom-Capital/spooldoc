import 'server-only';

/** How much the server logs, least to most. `off` logs nothing. */
export const LOG_LEVELS = ['off', 'error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Extra fields on a log line, such as the job or queue it is about and the error text. */
export type LogFields = Record<string, unknown>;

/** Writes one finished log line. Tests replace it. */
export type LogSink = (line: string) => void;

const stdout: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

let sink: LogSink = stdout;

/** Send log lines somewhere else, for tests. Null goes back to stdout. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? stdout;
}

/**
 * The level from SPOOLDOC_LOG_LEVEL, read on every call so a test can change it. An
 * unknown value gives the default, `info`; `getConfig` refuses it at start.
 */
export function logLevel(): LogLevel {
  const value = process.env.SPOOLDOC_LOG_LEVEL?.trim().toLowerCase();
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : 'info';
}

function write(level: Exclude<LogLevel, 'off'>, message: string, fields: LogFields = {}): void {
  if (LOG_LEVELS.indexOf(level) > LOG_LEVELS.indexOf(logLevel())) return;
  let line: string;
  try {
    line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...fields });
  } catch {
    // A field that cannot be written (a cycle) leaves the fields out, not the line.
    line = JSON.stringify({ time: new Date().toISOString(), level, msg: message });
  }
  try {
    sink(line);
  } catch {
    // Logging never breaks what it reports on.
  }
}

/**
 * The server log: one JSON object per line on stdout, with `time`, `level`, `msg` and
 * the fields given. Fields must already be redacted: pass error text through `redact`.
 */
export const log = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
