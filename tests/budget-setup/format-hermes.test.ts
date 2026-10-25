import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { parseTurkishMoney } from '../../src/features/budget-setup/input';
import { createSetupPreview } from '../../src/features/budget-setup/preview';

/** Load the actual compiled formatter with Hermes' number-only Intl boundary. */
function withNumberOnlyIntl(): (amountMinor: number) => string {
  class NumberOnlyFormat {
    private readonly formatter: Intl.NumberFormat;

    constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      this.formatter = new Intl.NumberFormat(locales, options);
    }

    format(value: number | bigint): string {
      if (typeof value === 'bigint') throw new TypeError('Cannot convert BigInt to number');
      return this.formatter.format(value);
    }
  }

  const loaded: { formatMinorTRY?: unknown } = {};
  runInNewContext(readFileSync(require.resolve('../../src/features/budget-setup/format'), 'utf8'), {
    exports: loaded,
    Intl: { NumberFormat: NumberOnlyFormat },
  }, { filename: 'format-hermes-regression.js', timeout: 1000 });
  const formatter = loaded.formatMinorTRY;
  if (typeof formatter !== 'function') throw new Error('Money formatter export is missing.');
  return (amountMinor) => {
    const result: unknown = formatter(amountMinor);
    if (typeof result !== 'string') throw new Error('Money formatter must return text.');
    return result;
  };
}

test('Hermes regression: preview amounts render when Intl.NumberFormat rejects BigInt', () => {
  const format = withNumberOnlyIntl();
  const preview = createSetupPreview({
    balance: '10.000,00', payday: '04.11.2026', savings: '1.000,00',
    payments: [{ id: 'rent', name: 'Örnek fatura', amount: '2.000,00', dueDate: '28.10.2026' }],
  }, { asOf: '2026-10-25T12:00:00+03:00', timeZone: 'Europe/Istanbul' });
  assert.equal(preview.status, 'ready');
  if (preview.status !== 'ready') throw new Error('Synthetic preview should be valid.');
  const result = preview.result;
  assert.equal(result.periodStatus, 'active');
  if (result.periodStatus !== 'active') throw new Error('Synthetic period should be active.');
  assert.deepEqual([
    format(result.daily.recommendedDailyMinor), format(result.spendableMinor),
    format(result.remainingBalanceMinor), format(result.reservedPaymentsMinor),
    format(result.savingsReservedMinor),
  ], ['₺700,00', '₺7.000,00', '₺10.000,00', '₺2.000,00', '₺1.000,00']);
});

test('Hermes regression: exact kuruş survives grouping boundaries and safe integer extremes', () => {
  const format = withNumberOnlyIntl();
  assert.equal(format(Number.MAX_SAFE_INTEGER), '₺90.071.992.547.409,91');
  assert.equal(format(Number.MIN_SAFE_INTEGER), '-₺90.071.992.547.409,91');
  for (const absolute of [0, 1, 9, 10, 99, 100, 101, 99999, 100000, 100001,
    99999999, 100000000, Number.MAX_SAFE_INTEGER - 100, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    for (const amount of [absolute, -absolute]) {
      const expected = amount === 0 ? 0 : amount;
      assert.deepEqual(parseTurkishMoney(format(amount).replace('₺', '')), { ok: true, value: expected });
    }
  }
});
