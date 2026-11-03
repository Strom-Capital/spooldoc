import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deliveryGroups, RunDeliveries } from '@/components/run-deliveries';
import type { DeliveryView } from '@/lib/types';

const delivery = (id: string, destinationId: string | null, kind: DeliveryView['kind'] = 'email'): DeliveryView => ({
  id,
  destinationId,
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

  it('show no IFS list for a run without IFS rows, such as one from before they were recorded', () => {
    const ifs = { destinationId: 'c', name: 'MYIFS', kind: 'ifs' as const };
    expect(deliveryGroups({ deliveryTargets: [ifs], deliveries: [] })).toEqual([]);
    expect(deliveryGroups({ deliveryTargets: [ifs], deliveries: [delivery('1', 'c', 'ifs')] })).toEqual([{ target: ifs, deliveries: [expect.objectContaining({ id: '1' })] }]);
    // Another kind keeps its empty list.
    expect(deliveryGroups({ deliveryTargets: [ifs, { destinationId: 'd', name: 'MYSFTP', kind: 'sftp' }], deliveries: [] }).map((group) => group.target.kind)).toEqual(['sftp']);
  });

  it('list the files written to an IFS folder with the path, size and time', () => {
    const written: DeliveryView = { ...delivery('1', 'c', 'ifs'), document: 'invoice-1001.pdf', to: '/home/docs/out/invoice-1001-2.pdf', size: 2048, ms: 120 };
    const before: DeliveryView = { ...delivery('2', 'c', 'ifs'), document: 'invoice-1002.pdf', to: '', status: 'already_sent', sentInRun: 4 };
    const html = renderToStaticMarkup(createElement(RunDeliveries, { kind: 'ifs', deliveries: [written, before] }));
    expect(html).toContain('Files written');
    expect(html).toContain('(2 of 2 written)');
    expect(html).toContain('invoice-1001-2.pdf');
    expect(html).toContain('/<wbr/>home/<wbr/>docs/<wbr/>out/<wbr/>invoice-1001-2.pdf');
    expect(html).toContain('2 KB in 120 ms');
    expect(html).toContain('Written in run #4');
    expect(html).toContain('An earlier run wrote it, so it was not written again.');
    expect(html).not.toContain('Not written');
  });
});

