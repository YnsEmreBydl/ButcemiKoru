import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCalendarDate, formatMinorTRY } from '../../src/features/budget-setup/format';
import { parseCalendarInput, parseTurkishMoney } from '../../src/features/budget-setup/input';

for (const [text, minor] of [
  ['0', 0], ['0,01', 1], ['12', 1200], ['12,5', 1250], ['12,50', 1250],
  ['1234,56', 123456], ['1.234,56', 123456], ['1.234', 123400],
  ['1.000.000,99', 100000099], ['-123,45', -12345], ['-0,01', -1],
  ['  1.234,50  ', 123450], ['00012,50', 1250], ['-0', 0],
  ['90071992547409,91', Number.MAX_SAFE_INTEGER],
  ['-90.071.992.547.409,91', Number.MIN_SAFE_INTEGER],
] as const) {
  test(`Turkish amount ${JSON.stringify(text)} becomes exactly ${minor} kuruş`, () => {
    assert.deepEqual(parseTurkishMoney(text), { ok: true, value: minor });
  });
}

for (const text of [
  '', ' ', 'NaN', 'Infinity', '-Infinity', '1e3', '1,001', '1.234,567', '1,', ',50',
  '1234.50', '1.23', '12.34,50', '0.001', '01.234', '1 234,50', '₺100', '100 TL',
  '+100', '--1', '1,2,3', '１２３', '90071992547409,92', '-90071992547409,92',
  '999999999999999999', '9'.repeat(65),
]) {
  test(`invalid or unsafe money is rejected: ${JSON.stringify(text)}`, () => {
    const parsed = parseTurkishMoney(text);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert(parsed.message.length > 0);
  });
}

test('excess decimal precision is rejected, never rounded', () => {
  const parsed = parseTurkishMoney('0,009');
  assert.deepEqual(parsed, { ok: false, message: 'Virgülden sonra en fazla iki hane yazın.' });
});

for (const [text, expected] of [
  ['06.11.2026', '2026-11-06'], ['6.11.2026', '2026-11-06'],
  ['29.02.2024', '2024-02-29'], ['2026-11-06', '2026-11-06'],
  [' 31.12.2026 ', '2026-12-31'],
] as const) {
  test(`calendar input ${text} preserves its calendar date`, () => {
    assert.deepEqual(parseCalendarInput(text), { ok: true, value: expected });
  });
}

for (const text of ['', '29.02.2025', '31.04.2026', '00.01.2026', '01.13.2026', '01.01.0000', '2026-02-30', '06/11/2026', '2026-11-06T00:00:00Z']) {
  test(`invalid calendar input is rejected: ${JSON.stringify(text)}`, () => {
    assert.equal(parseCalendarInput(text).ok, false);
  });
}

test('minor-unit display retains every kuruş up to the safe integer boundary', () => {
  assert.equal(formatMinorTRY(1), '₺0,01');
  assert.equal(formatMinorTRY(-48550), '-₺485,50');
  assert.equal(formatMinorTRY(Number.MAX_SAFE_INTEGER), '₺90.071.992.547.409,91');
  for (const amount of [0, 1, -1, 123450, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
    assert.deepEqual(parseTurkishMoney(formatMinorTRY(amount).replace('₺', '')), { ok: true, value: amount });
  }
  for (const amount of [NaN, Infinity, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatMinorTRY(amount), RangeError);
  }
  assert.equal(formatCalendarDate('2026-11-06'), '06.11.2026');
});
