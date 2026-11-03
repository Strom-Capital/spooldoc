import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deliveryGroups, RunDeliveries, UnroutedList } from '@/components/run-deliveries';
import type { DeliveryView } from '@/lib/types';

const delivery = (id: string, destinationId: string | null, kind: DeliveryView['kind'] = 'email'): DeliveryView => ({
  id,
  destinationId,
  route: null,
  kind,
  document: `invoice-${id}`,
  to: 'buyer@example.com',
  test: false,
  status: 'sent',
  sentInRun: null,
  error: null,
  detail: null,
  httpStatus: null,
  attempts: null,
  ms: null,
  response: null,
  responseTruncated: false,
  size: null,
  sentAt: '2026-10-18T08:15:00.000Z',
});

describe('the deliveries of a run', () => {
  it('make one list per destination of the version, in its order, and one per kind for the others', () => {
    const groups = deliveryGroups({
      deliveryTargets: [
        { destinationId: 'b', name: 'MYHOOK', kind: 'webhook' },
        { destinationId: 'a', name: 'Invoices by email', kind: 'email' },
      ],
      deliveries: [delivery('1', 'a'), delivery('2', 'b', 'webhook'), delivery('3', null), delivery('4', 'gone'), delivery('5', null, 'sftp')],
    });
    expect(groups.map((group) => [group.target.name, group.target.kind, group.deliveries.map((d) => d.id)])).toEqual([
      ['MYHOOK', 'webhook', ['2']],
      ['Invoices by email', 'email', ['1']],
      [null, 'email', ['3', '4']],
      [null, 'sftp', ['5']],
    ]);
  });

  it('keep the list of a destination that made no delivery, and show none for a run without such destinations', () => {
    expect(deliveryGroups({ deliveryTargets: [{ destinationId: 'a', name: 'Invoices by email', kind: 'email' }], deliveries: [] })).toEqual([
      { target: { destinationId: 'a', name: 'Invoices by email', kind: 'email' }, deliveries: [] },
    ]);
    expect(deliveryGroups({ deliveryTargets: [], deliveries: [] })).toEqual([]);
  });

  it('name the destination in the title only when given one', () => {
    expect(renderToStaticMarkup(createElement(RunDeliveries, { kind: 'email', deliveries: [] }))).toContain('Emails <');
    expect(renderToStaticMarkup(createElement(RunDeliveries, { kind: 'email', deliveries: [], destination: 'Invoices by email' }))).toContain('Emails through Invoices by email');
  });
});

describe('routes in the job log', () => {
  it('name the route of each delivery only when the run had several routes', () => {
    const routed = { ...delivery('1', 'a'), route: 2 };
    expect(renderToStaticMarkup(createElement(RunDeliveries, { kind: 'email', deliveries: [routed], routes: 2 }))).toContain('Route 2');
    expect(renderToStaticMarkup(createElement(RunDeliveries, { kind: 'email', deliveries: [routed], routes: 1 }))).not.toContain('Route 2');
  });

  it('list each document that took no route, and say how many more there are', () => {
    const unrouted = Array.from({ length: 52 }, (_, at) => ({ pageGroup: at, document: `invoice-${at + 1}`, reasons: ['pg.email is empty'] }));
    const html = renderToStaticMarkup(createElement(UnroutedList, { unrouted: [{ pageGroup: null, document: 'spdinvoice', reasons: ['Route 1: pg.email is empty'] }, ...unrouted] }));
    expect(html).toContain('Whole spooled file (spdinvoice):');
    expect(html).toContain('Page group 1 (invoice-1):');
    expect(html).toContain('Showing 50 of 53 documents.');
    expect(html).not.toContain('invoice-52');
  });
});
