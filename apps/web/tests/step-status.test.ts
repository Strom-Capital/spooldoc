import type { FieldHit } from '@spooldoc/core';
import { describe, expect, it } from 'vitest';
import type { RenderResult } from '@/lib/client/render';
import { allReady, missingFields, nextVariant, runVariant, stepStatuses, type StepStatus, type StepStatusInput } from '@/lib/client/step-status';
import { emptySpec, type JobSpec } from '@/lib/job-spec';

const hit = (name: string, status: FieldHit['status']): FieldHit => ({ pageGroup: 0, name, page: 1, line: 1, column: 1, length: 1, value: '', status });

function rendered(overrides: Partial<RenderResult> = {}): RenderResult {
  return {
    sample: {} as RenderResult['sample'],
    extract: { pageGroups: [{ invoiceNo: '260101' }], pageRanges: [{ first: 1, last: 1 }], hits: [hit('invoiceNo', 'found')], warnings: [] },
    html: '<p>260101</p>',
    pageGroup: 0,
    errors: [],
    ...overrides,
  };
}

function readySpec(): JobSpec {
  const spec = emptySpec({ serverId: 'server-1', library: 'MYLIB', queue: 'MYOUTQ', destinationId: 'destination-1' });
  return { ...spec, extract: { ...spec.extract, definition: 'fields: {}' }, finish: { action: 'hold', queue: null } };
}

function input(overrides: Partial<StepStatusInput> = {}): StepStatusInput {
  return {
    spec: readySpec(),
    job: { paused: false, lastWatchError: null, realtimeError: null },
    serverError: null,
    hasDestination: true,
    render: rendered(),
    rendering: true,
    ...overrides,
  };
}

describe('stepStatuses', () => {
  it('has every step ready for a complete job with a good render', () => {
    const statuses = stepStatuses(input());
    expect(statuses).toEqual({ source: 'ok', trigger: 'ok', extract: 'ok', lookups: 'ok', render: 'ok', destination: 'ok', finish: 'ok' });
    expect(allReady(statuses)).toBe(true);
  });

  it('leaves an empty draft unset where nothing is picked yet', () => {
    const statuses = stepStatuses(input({ spec: emptySpec(), hasDestination: false, render: null }));
    expect(statuses.source).toBe('unset');
    expect(statuses.extract).toBe('unset');
    expect(statuses.render).toBe('unset');
    expect(statuses.destination).toBe('unset');
    expect(allReady(statuses)).toBe(false);
  });

  it('has Lookups ready with none, a problem for one untested or failing, and worth a look for one that found no row', () => {
    const sql = 'SELECT EMAIL FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNo';
    const tested = { name: 'customer', sql, result: 'one' as const, missing: 'warn' as const, checked: { sql, columns: [{ name: 'EMAIL', type: 'string' as const }] } };
    const withLookups = (lookups: JobSpec['lookups'], lookupsPreview?: RenderResult['lookups']) =>
      stepStatuses(input({ spec: { ...readySpec(), lookups }, render: rendered(lookupsPreview ? { lookups: lookupsPreview } : {}) })).lookups;
    const preview = { traces: [], misses: [], problems: [], ran: ['customer'] };
    expect(withLookups([])).toBe('ok');
    expect(withLookups([tested], preview)).toBe('ok');
    expect(withLookups([{ ...tested, checked: undefined }], preview)).toBe('error');
    expect(withLookups([{ ...tested, sql: `${sql} AND 1 = 1` }], preview)).toBe('error');
    expect(withLookups([tested], { ...preview, error: { message: 'Could not run customer: MYLIB.CUSTOMERS was not found (SQL0204).', lookup: 'customer' } })).toBe('error');
    expect(withLookups([tested], { ...preview, misses: [{ lookup: 'customer', pageGroup: 0, text: 'No row in customer for customerNo 10042' }] })).toBe('warn');
  });

  it('warns about the source when its server has an error', () => {
    expect(stepStatuses(input({ serverError: 'CPF2204' })).source).toBe('warn');
  });

  it('warns about a watching trigger that is paused or failing, not an on demand one', () => {
    const base = readySpec();
    const watching = { ...base, trigger: { ...base.trigger, mode: 'watch' as const } };
    expect(stepStatuses(input({ spec: watching })).trigger).toBe('ok');
    expect(stepStatuses(input({ spec: watching, job: { paused: true, lastWatchError: null, realtimeError: null } })).trigger).toBe('warn');
    expect(stepStatuses(input({ spec: watching, job: { paused: false, lastWatchError: 'Timed out', realtimeError: null } })).trigger).toBe('warn');
    expect(stepStatuses(input({ job: { paused: true, lastWatchError: null, realtimeError: null } })).trigger).toBe('ok');
  });

  it('marks extract from the definition and the extraction', () => {
    const spec = readySpec();
    expect(stepStatuses(input({ spec: { ...spec, extract: { ...spec.extract, definition: '  ' } } })).extract).toBe('unset');
    expect(stepStatuses(input({ render: rendered({ definition: { type: 'lines', yaml: '', error: 'Bad YAML' } }) })).extract).toBe('error');
    expect(stepStatuses(input({ render: rendered({ extract: undefined }) })).extract).toBe('unset');
    expect(stepStatuses(input({ render: rendered({ extract: { pageGroups: [], pageRanges: [], hits: [], warnings: [] } }) })).extract).toBe('warn');
    const missing = rendered({ extract: { pageGroups: [{}], pageRanges: [{ first: 1, last: 1 }], hits: [hit('invoiceNo', 'missing')], warnings: [] } });
    expect(stepStatuses(input({ render: missing })).extract).toBe('warn');
  });

  it('marks render from Carbone, the template and the output', () => {
    expect(stepStatuses(input({ rendering: false })).render).toBe('warn');
    expect(stepStatuses(input({ render: rendered({ carbone: { error: 'No answer' } }) })).render).toBe('warn');
    expect(stepStatuses(input({ render: rendered({ template: { kind: 'html', html: '', error: 'Bad tag' } }) })).render).toBe('error');
    expect(stepStatuses(input({ render: rendered({ html: undefined }) })).render).toBe('unset');
    expect(stepStatuses(input({ render: rendered({ html: undefined, pdf: 'JVBERi0=' }) })).render).toBe('ok');
  });

  it('marks finish unset for a move without a queue, and ready for delete', () => {
    const spec = readySpec();
    expect(stepStatuses(input({ spec: { ...spec, finish: { action: 'move', queue: null } } })).finish).toBe('unset');
    expect(stepStatuses(input({ spec: { ...spec, finish: { action: 'delete', queue: null } } })).finish).toBe('ok');
  });
});

describe('missingFields', () => {
  it('counts each missing field once', () => {
    const hits = [hit('a', 'missing'), hit('a', 'missing'), hit('b', 'missing'), hit('c', 'found')];
    expect(missingFields({ pageGroups: [], pageRanges: [], hits, warnings: [] })).toBe(2);
  });
});

describe('forward buttons', () => {
  const statuses: StepStatus[] = ['unset', 'ok', 'warn', 'error'];

  it('makes Next primary only when the step is ready and the pipeline is not', () => {
    expect(nextVariant('ok', false)).toBe('default');
    expect(nextVariant('ok', true)).toBe('outline');
    for (const status of statuses.filter((s) => s !== 'ok')) {
      expect(nextVariant(status, false)).toBe('outline');
    }
  });

  it('makes Run now primary only when every step is ready', () => {
    expect(runVariant(true)).toBe('default');
    expect(runVariant(false)).toBe('outline');
  });

  it('never has Next and Run now primary at once', () => {
    for (const ready of [true, false]) {
      for (const status of statuses) {
        expect(nextVariant(status, ready) === 'default' && runVariant(ready) === 'default').toBe(false);
      }
    }
  });
});
