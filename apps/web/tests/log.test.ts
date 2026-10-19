import { afterEach, describe, expect, it } from 'vitest';
import { log, setLogSink } from '@/lib/server/log';

let lines: Record<string, unknown>[] = [];

function capture(level: string | undefined) {
  if (level === undefined) delete process.env.SPOOLDOC_LOG_LEVEL;
  else process.env.SPOOLDOC_LOG_LEVEL = level;
  lines = [];
  setLogSink((line) => lines.push(JSON.parse(line)));
}

afterEach(() => {
  setLogSink(null);
  process.env.SPOOLDOC_LOG_LEVEL = 'off';
});

describe('server log', () => {
  it('writes one JSON object per line with the time, level, message and fields', () => {
    capture('info');
    log.warn('Watching a job failed', { jobId: 'j1', error: 'Queue not found' });
    expect(lines).toEqual([{ time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), level: 'warn', msg: 'Watching a job failed', jobId: 'j1', error: 'Queue not found' }]);
  });

  it('leaves out what is below the level', () => {
    capture('warn');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
    capture('debug');
    log.debug('d');
    expect(lines.map((line) => line.level)).toEqual(['debug']);
  });

  it('logs nothing when off, and at info when the level is unset or unknown', () => {
    capture('off');
    log.error('e');
    expect(lines).toEqual([]);
    for (const level of [undefined, 'verbose']) {
      capture(level);
      log.debug('d');
      log.info('i');
      expect(lines.map((line) => line.msg)).toEqual(['i']);
    }
  });

  it('never throws, also for fields it cannot write', () => {
    capture('info');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => log.info('cycle', { cycle })).not.toThrow();
    expect(lines).toEqual([expect.objectContaining({ msg: 'cycle' })]);
    setLogSink(() => {
      throw new Error('stdout closed');
    });
    expect(() => log.info('lost')).not.toThrow();
  });
});
