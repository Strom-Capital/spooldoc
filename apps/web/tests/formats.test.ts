import { beforeEach, describe, expect, it } from 'vitest';
import { parseEmailTag } from '@/lib/email-fields';
import { carboneLocale, DEFAULT_FORMATS, formatC, formatD, formatN, formatPlainNumber, type Formats } from '@/lib/formats';
import { emailSpecSchema } from '@/lib/job-spec';
import { documentRenderer } from '@/lib/server/documents';
import { composeEmail, emailSpecProblems, expandSegments, expandText, fieldTypes, type EmailFormatting } from '@/lib/server/email-message';
import { getFormats, updateFormats } from '@/lib/server/formats';
import type { SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { fakeCarbone } from './helpers/carbone';
import { resetTables } from './helpers/db';
import { fixtureText } from './helpers/fake-connection';
import { db } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const settingsRoute = await import('@/app/api/settings/route');

beforeEach(async () => {
  await resetTables(db());
});

// Each expected value is what Carbone 5 printed for the same tag and data, with the same lang and currency.
describe('numbers, amounts and dates, as Carbone prints them', () => {
  it('formatN uses the separators of each number format, 3 decimals by default, rounding half up', () => {
    expect(formatN(1234567.891, 2, 'en-us')).toBe('1,234,567.89');
    expect(formatN(1234567.891, 2, 'sv-se')).toBe('1 234 567,89');
    expect(formatN(1234567.891, 2, 'de-de')).toBe('1.234.567,89');
    expect(formatN(1234567.891, 2, 'de-ch')).toBe('1’234’567.89');
    expect(formatN(1374.5, undefined, 'en-us')).toBe('1,374.500');
    expect(formatN(12)).toBe('12.000');
    expect(formatN(2.345, 2)).toBe('2.35');
    expect(formatN(1.005, 2)).toBe('1.01');
    expect(formatN(0.125, 2)).toBe('0.13');
    expect(formatN(2.5, 0)).toBe('3');
    expect(formatN(-2.5, 0)).toBe('-2');
    expect(formatN(-1.005, 2)).toBe('-1.00');
    expect(formatN(-1234.565, 2)).toBe('-1,234.56');
    expect(formatN(-0.004, 2)).toBe('0.00');
    expect(formatN(1234567890.45, 1)).toBe('1,234,567,890.5');
    expect(formatN('1234.5', 2)).toBe('1,234.50');
  });

  it('formatN and formatC print nothing for a value that is not a number', () => {
    for (const value of ['abc', '12,5', '', null, undefined, true]) {
      expect(formatN(value, 2)).toBeNull();
      expect(formatC(value, 2)).toBeNull();
    }
  });

  it('formatC puts the currency where each number format puts it, 2 decimals by default', () => {
    const c = (numberFormat: Formats['numberFormat'], currency: string | null, value = 1234.567, decimals?: number) => formatC(value, decimals, { numberFormat, currency });
    expect(c('en-us', null)).toBe('$1,234.57');
    expect(c('en-us', 'EUR')).toBe('€1,234.57');
    expect(c('en-us', 'SEK')).toBe('kr1,234.57');
    expect(c('en-us', 'CHF', -5)).toBe('CHF-5.00');
    expect(c('en-us', 'USD', 1234.567, 0)).toBe('$1,235');
    expect(c('sv-se', null)).toBe('1 234,57 kr');
    expect(c('sv-se', 'EUR', -5)).toBe('-5,00 €');
    expect(c('de-de', null)).toBe('1.234,57 €');
    expect(c('de-de', 'GBP')).toBe('1.234,57 £');
    expect(c('de-ch', null)).toBe('CHF 1’234.57');
    expect(c('de-ch', 'EUR', -5)).toBe('€ -5.00');
    expect(c('de-ch', 'JPY', 1234.567, 0)).toBe('¥ 1’235');
  });

  it('formatC passes the amount through the rate of its currency, as Carbone does', () => {
    const c = (numberFormat: Formats['numberFormat'], currency: string | null, value: number, decimals?: number) => formatC(value, decimals, { numberFormat, currency });
    expect(c('en-us', 'GBP', 0.5, 0)).toBe('£0');
    expect(c('en-us', 'GBP', 999.995)).toBe('£999.99');
    expect(c('en-us', 'USD', 999.995)).toBe('$1,000.00');
    expect(c('de-ch', null, 0.5, 0)).toBe('CHF 0');
    expect(c('de-ch', null, 999.995)).toBe('CHF 1’000.00');
  });

  it('formatD takes a day.js pattern with the month and day names of the number format', () => {
    expect(formatD('2026-03-05', 'DD.MM.YYYY')).toBe('05.03.2026');
    expect(formatD('2026-03-05', 'D MMMM YYYY', 'en-us')).toBe('5 March 2026');
    expect(formatD('2026-03-05', 'D MMMM YYYY', 'sv-se')).toBe('5 mars 2026');
    expect(formatD('2026-03-05', 'dddd D MMM YY', 'de-de')).toBe('Donnerstag 5 März 26');
    expect(formatD('2026-01-01', 'ddd dd MMM', 'de-ch')).toBe('Do Do Jan.');
    expect(formatD('2026-03-05', 'L', 'sv-se')).toBe('2026-03-05');
    expect(formatD('2026-03-05', 'LL', 'de-de')).toBe('5. März 2026');
    expect(formatD('2026-03-05', '[Due] D.M.')).toBe('Due 5.3.');
    expect(formatD('abc', 'DD.MM.YYYY')).toBeNull();
    expect(formatD('', 'DD.MM.YYYY')).toBeNull();
    expect(formatD(null, 'DD.MM.YYYY')).toBeNull();
  });

  it('a number without a formatter keeps its decimals', () => {
    expect(formatPlainNumber(1374.5, 'en-us')).toBe('1,374.5');
    expect(formatPlainNumber(1374.5, 'de-de')).toBe('1.374,5');
    expect(formatPlainNumber(-1234, 'de-ch')).toBe('-1’234');
  });

  it('the defaults send en-us and no currency, as every render did before', () => {
    expect(DEFAULT_FORMATS).toEqual({ numberFormat: 'en-us', dateFormat: 'YYYY-MM-DD', currency: null });
    expect(carboneLocale(DEFAULT_FORMATS)).toEqual({ lang: 'en-us' });
    expect(carboneLocale({ numberFormat: 'de-de', dateFormat: 'DD.MM.YYYY', currency: 'EUR' })).toEqual({ lang: 'de-de', currencySource: 'EUR', currencyTarget: 'EUR' });
  });
});

describe('formatters in email fields', () => {
  const def = { type: 'invoice', version: 1, source: 'text', text: { fields: [{ name: 'invoiceNo' }, { name: 'dueDate', type: 'date' }, { name: 'totalAmount', type: 'number' }, { name: 'currency' }] } } as never;
  const data = { pg: { invoiceNo: '260101', dueDate: '2026-10-29', totalAmount: 1374.5, currency: 'EUR', empty: '' }, splf: { name: 'SPDINVOICE', number: 34 } };
  const formatting = (formats: Partial<Formats> = {}): EmailFormatting => ({ formats: { ...DEFAULT_FORMATS, ...formats }, types: fieldTypes(def) });
  const say = (text: string, formats: Partial<Formats> = {}) => expandText(text, data, formatting(formats)).text;

  it('read formatN, formatC and formatD as templates do', () => {
    expect(say('{d.pg.totalAmount:formatC(2)}', { numberFormat: 'de-de' })).toBe('1.374,50\u00a0€');
    expect(say('{d.pg.totalAmount:formatC}', { currency: 'EUR' })).toBe('€1,374.50');
    expect(say('{d.pg.totalAmount:formatN(2)} {d.pg.currency}', { numberFormat: 'sv-se' })).toBe('1\u00a0374,50 EUR');
    expect(say("{d.pg.dueDate:formatD('DD.MM.YYYY')}")).toBe('29.10.2026');
    expect(say("{d.pg.dueDate:formatD('D MMMM YYYY')}", { numberFormat: 'sv-se' })).toBe('29\u00a0oktober\u00a02026');
  });

  it('print a date field in the date format of Settings, and a number with its own decimals', () => {
    expect(say('Due {d.pg.dueDate}')).toBe('Due 2026-10-29');
    for (const [dateFormat, out] of [
      ['DD.MM.YYYY', '29.10.2026'],
      ['DD/MM/YYYY', '29/10/2026'],
      ['MM/DD/YYYY', '10/29/2026'],
    ] as const) {
      expect(say('{d.pg.dueDate}', { dateFormat })).toBe(out);
    }
    expect(say('The total is {d.pg.totalAmount} {d.pg.currency}')).toBe('The total is 1,374.5 EUR');
    expect(say('{d.pg.totalAmount}', { numberFormat: 'de-ch' })).toBe('1’374.5');
    expect(say('Invoice {d.pg.invoiceNo}', { numberFormat: 'de-de' })).toBe('Invoice 260101');
  });

  it('keep a formatted value on one line with no-break spaces, in the subject, the text and the HTML', () => {
    const swedishEuro = formatting({ numberFormat: 'sv-se', currency: 'EUR' });
    const big = { ...data, pg: { ...data.pg, totalAmount: 1374.5 } };
    expect(expandText('{d.pg.totalAmount:formatC(2)}', big, swedishEuro).text).toBe('1 374,50 €');
    expect(expandText('{d.pg.totalAmount:formatC(2)}', big, formatting({ numberFormat: 'de-ch' })).text).toBe('CHF 1’374.50');
    expect(expandText('{d.pg.totalAmount}', big, formatting({ numberFormat: 'sv-se' })).text).toBe('1 374,5');
    // Templates keep Carbone's own spaces.
    expect(formatC(1374.5, 2, { numberFormat: 'sv-se', currency: 'EUR' })).toBe('1 374,50 €');
    const { email } = composeEmail({
      spec: emailSpecSchema.parse({ to: 'buyer@example.com', subject: 'Invoice {d.pg.invoiceNo}, {d.pg.totalAmount:formatC(2)}', body: 'The total of {d.pg.totalAmount:formatC(2)} is due.' }),
      data: big,
      document: 'invoice-260101',
      files: [],
      from: 'invoices@example.com',
      testAddress: null,
      formatting: swedishEuro,
    });
    expect(email?.subject).toBe('Invoice 260101, 1 374,50 €');
    expect(email?.message.text).toBe('The total of 1 374,50 € is due.');
    expect(email?.html).toContain('The total of 1 374,50 € is due.');
  });

  it('print nothing for a missing value, and say so', () => {
    expect(expandSegments('{d.pg.empty:formatC(2)}', data, formatting())).toEqual([{ text: '', tag: '{d.pg.empty:formatC(2)}', state: 'empty' }]);
    expect(expandSegments('{d.pg.nope:formatN(2)}', data, formatting())).toEqual([{ text: '', tag: '{d.pg.nope:formatN(2)}', state: 'missing' }]);
    expect(expandSegments("{d.pg.currency:formatD('DD.MM.YYYY')}", data, formatting())[0]?.state).toBe('empty');
  });

  it('refuse any other formatter or a bad argument, before a version is saved', () => {
    expect(parseEmailTag('{d.pg.totalAmount:formatC(2)}')).toEqual({ ok: true, path: 'pg.totalAmount', formatter: 'formatC', decimals: 2 });
    expect(parseEmailTag('{d.pg.invoiceNo:upperCase}')).toMatchObject({ ok: false, problem: expect.stringContaining('Email fields take formatN, formatC and formatD') });
    expect(parseEmailTag('{d.pg.totalAmount:formatN(two)}')).toMatchObject({ ok: false, problem: '{d.pg.totalAmount:formatN(two)}: formatN takes a number of decimals from 0 to 10, such as formatN(2).' });
    expect(parseEmailTag('{d.pg.dueDate:formatD(DD.MM.YYYY)}')).toMatchObject({ ok: false, problem: expect.stringContaining("formatD takes a pattern in single quotes") });
    expect(parseEmailTag('{d.pg.a:formatN(2):formatC}')).toMatchObject({ ok: false });
    expect(expandSegments('{d.pg.invoiceNo:upperCase}', data, formatting())[0]?.state).toBe('missing');
    const spec = emailSpecSchema.parse({ to: 'buyer@example.com', subject: 'Invoice {d.pg.invoiceNo:upperCase}, {d.pg.totalAmount:formatC(2)}' });
    const problems = emailSpecProblems(spec, def, [{ id: 'template-1', name: 'Invoice', kind: 'html', source: null, formats: ['pdf'] }]);
    expect(problems).toEqual([expect.stringMatching(/^Subject: \{d\.pg\.invoiceNo:upperCase\} uses upperCase\. Email fields take formatN, formatC and formatD/)]);
  });

  it('know the types of the invoice definition', () => {
    const types = fieldTypes(JSON.parse(JSON.stringify({ type: 'invoice', version: 1, source: 'text', text: { fields: [{ name: 'dueDate', type: 'date' }] } })));
    expect(types).toMatchObject({ 'pg.dueDate': 'date', 'splf.number': 'number' });
    expect(fixtureText('invoice', 'definition.yaml')).toContain('type: date');
  });
});

describe('Formats in Settings', () => {
  it('start at the defaults and are saved, and every render sends them to Carbone', async () => {
    expect(await getFormats()).toEqual(DEFAULT_FORMATS);
    const render = await documentRenderer();
    await render({ template: '<p>{d.pg.a}</p>', data: { pg: { a: 1 }, splf: {} }, format: 'html' });
    expect(fakeCarbone.mock.calls.at(-1)?.[0].locale).toEqual({ lang: 'en-us' });

    const auth = await signedIn();
    const put = (formats: unknown) => settingsRoute.PUT(appRequest('/api/settings', { method: 'PUT', body: { formats }, headers: auth }));
    const saved = (await (await put({ numberFormat: 'de-ch', dateFormat: 'DD.MM.YYYY', currency: 'eur' })).json()) as SettingsView;
    expect(saved.formats).toEqual({ numberFormat: 'de-ch', dateFormat: 'DD.MM.YYYY', currency: 'EUR' });
    const again = await documentRenderer();
    await again({ kind: 'docx', template: new Uint8Array([1]), data: { pg: {}, splf: {} }, format: 'pdf' });
    expect(fakeCarbone.mock.calls.at(-1)?.[0].locale).toEqual({ lang: 'de-ch', currencySource: 'EUR', currencyTarget: 'EUR' });

    expect(((await (await put({ numberFormat: 'de-ch', dateFormat: 'DD.MM.YYYY', currency: '' })).json()) as SettingsView).formats.currency).toBeNull();
    const refused = await put({ numberFormat: 'fi-fi', dateFormat: 'DD.MM.YYYY', currency: null });
    expect(refused.status).toBe(400);
    const unknown = await put({ numberFormat: 'en-us', dateFormat: 'DD.MM.YYYY', currency: 'XYZ' });
    expect((await unknown.json()).error).toMatch(/^Enter a currency code Carbone knows/);
    await updateFormats(DEFAULT_FORMATS);
  });
});
