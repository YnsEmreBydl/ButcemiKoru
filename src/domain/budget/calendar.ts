import { BudgetInputError } from './errors';

type ParsedDate = Readonly<{ value: string; ordinal: number }>;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;

export function parseCalendarDate(value: unknown, field: string): ParsedDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BudgetInputError('INVALID_DATE', field, 'Expected YYYY-MM-DD.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && leap ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > maxDay) {
    throw new BudgetInputError('INVALID_DATE', field, 'Invalid Gregorian calendar date.');
  }
  const previousYear = year - 1;
  const ordinal =
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400) +
    DAYS_BEFORE_MONTH[month - 1] +
    (month > 2 && leap ? 1 : 0) +
    day - 1;
  return { value, ordinal };
}

export function parseInstant(value: unknown, field: string): number {
  // Millisecond precision only. Reject implicit/unknown offsets and normalized invalid dates.
  const pattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  if (typeof value !== 'string' || !pattern.test(value) || value.endsWith('-00:00')) {
    throw new BudgetInputError('INVALID_INSTANT', field, 'Expected an ISO instant with a known offset and at most millisecond precision.');
  }
  parseCalendarDate(value.slice(0, 10), field);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new BudgetInputError('INVALID_INSTANT', field, 'Invalid instant.');
  }
  return milliseconds;
}

export function calendarFormatter(timeZone: unknown): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.trim() !== timeZone || /^[+-]/.test(timeZone)) {
    throw new BudgetInputError('INVALID_TIME_ZONE', 'timeZone', 'Expected an explicit named time zone.');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      era: 'short',
    });
  } catch {
    throw new BudgetInputError('INVALID_TIME_ZONE', 'timeZone', 'Unsupported time zone.');
  }
}

export function dateAt(milliseconds: number, formatter: Intl.DateTimeFormat): ParsedDate {
  const parts = formatter.formatToParts(milliseconds);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  if (part('era') !== 'AD') {
    throw new BudgetInputError('INVALID_DATE', 'localDate', 'Supported local years are 0001–9999.');
  }
  return parseCalendarDate(
    `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`,
    'localDate',
  );
}

/** Calendar subtraction, never elapsed milliseconds divided by 24 hours. */
export function calendarDaysBetween(from: string, to: string): number {
  return parseCalendarDate(to, 'to').ordinal - parseCalendarDate(from, 'from').ordinal;
}

export function calendarDateAt(instant: string, timeZone: string): string {
  return dateAt(parseInstant(instant, 'instant'), calendarFormatter(timeZone)).value;
}
