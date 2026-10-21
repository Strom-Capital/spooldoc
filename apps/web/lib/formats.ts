// How numbers, amounts and dates print: the Formats section of Settings. Carbone prints
// them in documents from the `lang` and the currency sent with each render; email fields
// print them here, by the same rules, so an email and its PDF show the same values.

import dayjs from 'dayjs';
import 'dayjs/locale/de';
import 'dayjs/locale/de-ch';
import 'dayjs/locale/sv';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { z } from 'zod';

dayjs.extend(localizedFormat);

/**
 * The number formats, each a Carbone `lang`, checked against Carbone 5: its separators,
 * the language of month and day names in `formatD`, the currency `formatC` prints when
 * Settings picks none, and where the currency goes. Carbone has no space-separated
 * format for Finnish, Norwegian or Danish (it prints those with English separators), so
 * Swedish stands for `1 234,56`.
 */
export const NUMBER_FORMATS = [
  { lang: 'en-us', example: '1,234.56', language: 'English', group: ',', decimal: '.', currency: 'USD', symbol: 'before' },
  { lang: 'sv-se', example: '1 234,56', language: 'Swedish', group: ' ', decimal: ',', currency: 'SEK', symbol: 'after' },
  { lang: 'de-de', example: '1.234,56', language: 'German', group: '.', decimal: ',', currency: 'EUR', symbol: 'after' },
  { lang: 'de-ch', example: '1’234.56', language: 'Swiss German', group: '’', decimal: '.', currency: 'CHF', symbol: 'before-space' },
] as const;
export type NumberLang = (typeof NUMBER_FORMATS)[number]['lang'];
export const NUMBER_LANGS = NUMBER_FORMATS.map((format) => format.lang) as [NumberLang, ...NumberLang[]];

/** The day.js locale of each number format, the one Carbone uses for month and day names. */
const DAYJS_LOCALE: Record<NumberLang, string> = { 'en-us': 'en', 'sv-se': 'sv', 'de-de': 'de', 'de-ch': 'de-ch' };

/** The date formats an email field uses for a date without `formatD`. */
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** The currencies Carbone knows, with the symbol `formatC` prints. A code Carbone does not know fails the render. */
export const CURRENCIES: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  ISK: 'kr',
  CHF: 'CHF',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  CAD: '$',
  AUD: '$',
  NZD: '$',
  MXN: '$',
  BRL: 'R$',
  ZAR: 'R',
};

/** Carbone's built-in rates against the euro, which `formatC` passes every amount through. */
const CURRENCY_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.1403,
  GBP: 0.854701,
  SEK: 10.246,
  NOK: 9.8648,
  DKK: 7.4679,
  ISK: 134,
  CHF: 1.1256,
  PLN: 4.2957,
  CZK: 25.653,
  HUF: 321.45,
  JPY: 123.2,
  CNY: 7.828,
  INR: 79.4315,
  CAD: 1.5328,
  AUD: 1.6189,
  NZD: 1.7045,
  MXN: 22.308,
  BRL: 4.2889,
  ZAR: 16.1175,
};

/** The currencies offered first in Settings. */
export const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF'] as const;

/** The Formats section of Settings. `currency` null is the number format's own, as Carbone does without one. */
export interface Formats {
  numberFormat: NumberLang;
  dateFormat: DateFormat;
  currency: string | null;
}

/** What every document printed before Formats existed: English separators, ISO dates, and the dollar of `en-us`. */
export const DEFAULT_FORMATS: Formats = { numberFormat: 'en-us', dateFormat: 'YYYY-MM-DD', currency: null };

/** The Formats part of a settings change. */
export const formatsSchema = z.object({
  numberFormat: z.enum(NUMBER_LANGS, 'Choose a number format from the list'),
  dateFormat: z.enum(DATE_FORMATS, 'Choose a date format from the list'),
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === '' || value in CURRENCIES, `Enter a currency code Carbone knows: ${Object.keys(CURRENCIES).join(', ')}`)
    .transform((value) => value || null)
    .nullable(),
});

const numberFormat = (lang: NumberLang) => NUMBER_FORMATS.find((format) => format.lang === lang) ?? NUMBER_FORMATS[0];

/** The currency `formatC` prints with these formats: the one picked, or the number format's own. */
export function currencyOf(formats: Pick<Formats, 'numberFormat' | 'currency'>): string {
  return formats.currency ?? numberFormat(formats.numberFormat).currency;
}

/** What Carbone gets with each render: the `lang`, and the currency when one is picked. */
export function carboneLocale(formats: Formats): { lang: string; currencySource?: string; currencyTarget?: string } {
  return formats.currency ? { lang: formats.numberFormat, currencySource: formats.currency, currencyTarget: formats.currency } : { lang: formats.numberFormat };
}

/** A value as a number, as Carbone reads it: numbers, and strings such as "1234.5". Null for anything else. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Rounds half up at `decimals`, in decimal, as Carbone does: 1.005 is 1.01, -2.5 is -2. */
function round(value: number, decimals: number): number {
  return Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
}

/** Digits with the format's separators. `decimals` null keeps the number's own decimals. */
function separated(value: number, decimals: number | null, lang: NumberLang): string {
  const { group, decimal } = numberFormat(lang);
  // Rounded with its sign, as Carbone does: -2.5 is -2.
  const rounded = decimals === null ? value : round(value, decimals);
  const fixed = decimals === null ? String(Math.abs(value)) : Math.abs(rounded).toFixed(decimals);
  const [whole = '0', fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  // -0.004 rounds to 0.00, which Carbone prints without a sign.
  const negative = rounded < 0 && Number(fixed) !== 0;
  return `${negative ? '-' : ''}${grouped}${fraction !== undefined ? decimal + fraction : ''}`;
}

/** `formatN(decimals)`: a number with the format's separators, 3 decimals by default. Null when the value is not a number. */
export function formatN(value: unknown, decimals = 3, lang: NumberLang = 'en-us'): string | null {
  const number = asNumber(value);
  return number === null ? null : separated(number, decimals, lang);
}

/** A number without a formatter: its own decimals, with the format's separators. */
export function formatPlainNumber(value: number, lang: NumberLang): string {
  return separated(value, null, lang);
}

/**
 * `formatC(decimals)`: an amount with the currency's symbol where the number format puts
 * it ($1,234.57, 1 234,57 kr, 1.234,57 €, CHF 1’234.57), 2 decimals by default.
 */
export function formatC(value: unknown, decimals = 2, formats: Pick<Formats, 'numberFormat' | 'currency'> = DEFAULT_FORMATS): string | null {
  const number = asNumber(value);
  if (number === null) return null;
  const code = currencyOf(formats);
  const symbol = CURRENCIES[code] ?? code;
  // Carbone converts the amount from the currency to itself through its rate, and prints
  // what floating point makes of it: 0.5 in GBP is £0. Do the same, so emails match.
  const rate = CURRENCY_RATES[code];
  const amount = separated(rate ? (number / rate) * rate : number, decimals, formats.numberFormat);
  const at = numberFormat(formats.numberFormat).symbol;
  return at === 'before' ? `${symbol}${amount}` : at === 'before-space' ? `${symbol} ${amount}` : `${amount} ${symbol}`;
}

/** `formatD(pattern)`: a date in a day.js pattern, with the number format's month and day names. Null when it is not a date. */
export function formatD(value: unknown, pattern: string, lang: NumberLang = 'en-us'): string | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const date = dayjs(value as string | number);
  return date.isValid() ? date.locale(DAYJS_LOCALE[lang]).format(pattern) : null;
}

/** An example of each choice, for Settings. */
export const EXAMPLE_DATE = '2026-10-29';
