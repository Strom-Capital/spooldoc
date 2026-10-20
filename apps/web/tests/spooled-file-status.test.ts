import { describe, expect, it } from 'vitest';
import {
  orderStatuses,
  SPOOLED_FILE_STATUSES,
  spooledFileStatusLabel,
  spooledFileTone,
  statusFilterLabel,
  statusParam,
} from '@/lib/spooled-file-status';

describe('spooled file status', () => {
  it('gives each known status a tone', () => {
    expect(spooledFileTone('READY')).toBe('ready');
    expect(spooledFileTone('HELD')).toBe('held');
    for (const status of ['OPEN', 'WRITING', 'PENDING', 'PRINTING', 'SENDING']) expect(spooledFileTone(status)).toBe('busy');
    expect(spooledFileTone('MESSAGE')).toBe('message');
    for (const status of ['SAVED', 'DEFERRED', 'CLOSED', 'FINISHED']) expect(spooledFileTone(status)).toBe('neutral');
  });

  it('reads the status in any case, with spaces around it', () => {
    expect(spooledFileTone(' ready ')).toBe('ready');
    expect(spooledFileStatusLabel('held ')).toBe('Held');
  });

  it('says the word in sentence case', () => {
    expect(spooledFileStatusLabel('READY')).toBe('Ready');
    expect(spooledFileStatusLabel('PRINTING')).toBe('Printing');
  });

  it('shows a status it does not know as it came, and neutral', () => {
    expect(spooledFileTone('NEWSTATUS')).toBe('neutral');
    expect(spooledFileStatusLabel('NEWSTATUS')).toBe('NEWSTATUS');
    expect(spooledFileStatusLabel('')).toBe('Unknown');
  });

  it('labels the filter button', () => {
    expect(statusFilterLabel([])).toBe('Status');
    expect(statusFilterLabel(['HELD'])).toBe('Held');
    expect(statusFilterLabel(['HELD', 'READY'])).toBe('Ready, Held');
    expect(statusFilterLabel(['READY', 'HELD', 'SAVED'])).toBe('3 statuses');
    expect(statusFilterLabel([...SPOOLED_FILE_STATUSES])).toBe('Status');
  });

  it('sends the picked statuses, or none for any status', () => {
    expect(statusParam([])).toBeUndefined();
    expect(statusParam(['HELD', 'READY'])).toBe('READY,HELD');
    expect(statusParam([...SPOOLED_FILE_STATUSES])).toBeUndefined();
  });

  it('orders statuses as the filter lists them, unknown ones last', () => {
    expect(orderStatuses(['FINISHED', 'OTHER', 'SAVED', 'READY'])).toEqual(['READY', 'SAVED', 'FINISHED', 'OTHER']);
  });
});
