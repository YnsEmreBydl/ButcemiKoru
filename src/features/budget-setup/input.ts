import { BudgetInputError, calendarDaysBetween } from '../../domain/budget';

import type { ParsedField } from './types';

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** Turkish notation only: comma is decimal, dot is a strictly grouped thousands separator. */
export function parseTurkishMoney(text: string): ParsedField<number> {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, message: 'Lütfen bir tutar yazın.' };
  }
  const value = text.trim();
  if (value.length > 64) {
    return { ok: false, message: 'Bu tutar desteklenen sınırı aşıyor.' };
  }
  if (/,\d{3,}$/.test(value)) {
    return { ok: false, message: 'Virgülden sonra en fazla iki hane yazın.' };
  }
  const match = /^(-)?(\d+|[1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(value);
  if (!match) {
    return { ok: false, message: 'Geçerli bir tutar yazın. Ondalık için virgül kullanın: 1.234,50.' };
  }
  const whole = match[2].replace(/\./g, '');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const digits = (whole + fraction).replace(/^0+/, '') || '0';
  if (digits.length > 16) {
    return { ok: false, message: 'Bu tutar desteklenen sınırı aşıyor.' };
  }
  const absoluteMinor = BigInt(digits);
  if (absoluteMinor > MAX_MINOR) {
    return { ok: false, message: 'Bu tutar desteklenen sınırı aşıyor.' };
  }
  const signedMinor = match[1] ? -absoluteMinor : absoluteMinor;
  return { ok: true, value: Number(signedMinor) };
}

export function parseCalendarInput(text: string): ParsedField<string> {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, message: 'Lütfen bir tarih yazın.' };
  }
  const value = text.trim();
  const turkish = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const iso = turkish
    ? `${turkish[3]}-${turkish[2].padStart(2, '0')}-${turkish[1].padStart(2, '0')}`
    : value;
  try {
    calendarDaysBetween(iso, iso);
    return { ok: true, value: iso };
  } catch (error) {
    if (!(error instanceof BudgetInputError)) throw error;
    return { ok: false, message: 'Geçerli bir tarih yazın. Örnek: 06.11.2026.' };
  }
}
