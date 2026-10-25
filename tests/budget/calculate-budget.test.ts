import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateBudget, simulateExpense, type BudgetInput } from '../../src/domain/budget';

import { budget, deepFreeze } from './fixtures';

test('normal budget: prior spending, today spending, bills and savings', () => {
  const result = calculateBudget(budget({
    transactions: [
      { id: 'historical', kind: 'expense', amountMinor: 60_000, occurredAt: '2026-10-19T10:00:00+03:00' },
      { id: 'yesterday', kind: 'expense', amountMinor: 100_000, occurredAt: '2026-10-24T10:00:00+03:00' },
      { id: 'today', kind: 'expense', amountMinor: 50_000, occurredAt: '2026-10-25T10:00:00+03:00' },
    ],
  }));
  assert.deepEqual(result, {
    currency: 'TRY', minorUnitDigits: 2, timeZone: 'Europe/Istanbul', today: '2026-10-25', nextPayday: '2026-11-04',
    daysUntilPayday: 10, spentSinceSnapshotMinor: 150_000, todayOutflowMinor: 50_000, todayBudgetImpactMinor: 50_000,
    remainingBalanceMinor: 850_000, reservedPaymentsMinor: 200_000, reservedPaymentIds: ['rent'],
    savingsReservedMinor: 100_000, spendableAtDayStartMinor: 600_000, spendableMinor: 550_000, budgetDeficitMinor: 0,
    periodStatus: 'active', requiresNewPeriod: false,
    daily: {
      recommendedDailyMinor: 55_000, todayStartTargetMinor: 60_000, todayRemainingMinor: 10_000,
      forwardDailyAverageMinor: 60_000, daysAfterToday: 9, uniformRemainderMinor: 0, forwardRemainderMinor: 0,
    },
  });
});

test('no expenses, bills or savings reserves', () => {
  const result = calculateBudget(budget({ payments: [], savingsTargetMinor: 0 }));
  assert.equal(result.remainingBalanceMinor, 1_000_000);
  assert.equal(result.spendableMinor, 1_000_000);
  assert.equal(result.daily?.recommendedDailyMinor, 100_000);
  assert.equal(result.daily?.todayRemainingMinor, 100_000);
  assert.equal(result.daily?.forwardDailyAverageMinor, 100_000);
});

test('overspending preserves negative balances and a separate deficit', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 100_000, capturedAt: '2026-10-20T09:00:00+03:00' },
    payments: [], savingsTargetMinor: 0,
    transactions: [{ id: 'over', kind: 'expense', amountMinor: 150_000, occurredAt: '2026-10-25T11:00:00+03:00' }],
  }));
  assert.equal(result.remainingBalanceMinor, -50_000);
  assert.equal(result.spendableMinor, -50_000);
  assert.equal(result.budgetDeficitMinor, 50_000);
  assert.equal(result.daily?.recommendedDailyMinor, 0);
  assert.equal(result.daily?.todayRemainingMinor, -140_000);
  assert.equal(result.daily?.forwardDailyAverageMinor, 0);
});

test('unfunded reserves report a deficit even when the account is positive', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 100_000, capturedAt: '2026-10-20T09:00:00+03:00' },
  }));
  assert.equal(result.remainingBalanceMinor, 100_000);
  assert.equal(result.spendableMinor, -200_000);
  assert.equal(result.budgetDeficitMinor, 200_000);
  assert.equal(result.daily?.todayStartTargetMinor, 0);
});

test('zero opening balance produces zero daily allocations', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 0, capturedAt: '2026-10-20T09:00:00+03:00' },
    payments: [], savingsTargetMinor: 0,
  }));
  assert.equal(result.spendableMinor, 0);
  assert.equal(result.budgetDeficitMinor, 0);
  assert.equal(result.daily?.recommendedDailyMinor, 0);
  assert.equal(result.daily?.todayRemainingMinor, 0);
});

for (const [nextPayday, status, days] of [
  ['2026-10-25', 'payday-today', 0],
  ['2026-10-24', 'payday-passed', -1],
] as const) {
  test(`${status}: no invented future period and no division by zero`, () => {
    const result = calculateBudget(budget({ nextPayday }));
    assert.equal(result.nextPayday, nextPayday);
    assert.equal(result.daysUntilPayday, days);
    assert.equal(result.periodStatus, status);
    assert.equal(result.requiresNewPeriod, true);
    assert.equal(result.daily, null);
    assert.equal(result.remainingBalanceMinor, 1_000_000);
  });
}

test('the day before payday has no fictional tomorrow allocation', () => {
  const result = calculateBudget(budget({ nextPayday: '2026-10-26' }));
  assert.equal(result.daily?.daysAfterToday, 0);
  assert.equal(result.daily?.forwardDailyAverageMinor, null);
  assert.equal(result.daily?.forwardRemainderMinor, 0);
});

test('multiple expenses do not reset or repeatedly divide the start-of-day target', () => {
  const first = budget({
    transactions: [{ id: 'one', kind: 'expense', amountMinor: 50_000, occurredAt: '2026-10-25T10:00:00+03:00' }],
  });
  const second = { ...first, transactions: [...first.transactions,
    { id: 'two', kind: 'expense' as const, amountMinor: 30_000, occurredAt: '2026-10-25T11:00:00+03:00' },
  ] };
  const a = calculateBudget(first);
  const b = calculateBudget(second);
  assert.equal(a.daily?.todayStartTargetMinor, 70_000);
  assert.equal(b.daily?.todayStartTargetMinor, 70_000);
  assert.equal(a.daily?.todayRemainingMinor, 20_000);
  assert.equal(b.daily?.todayRemainingMinor, -10_000);
  assert.equal(b.spendableMinor, 620_000);
  assert.equal(b.daily?.forwardDailyAverageMinor, 68_888);
  assert.equal(b.daily?.forwardRemainderMinor, 8);
});

test('an exact bill settlement debits cash and releases its reserve only once', () => {
  const before = calculateBudget(budget());
  const after = calculateBudget(budget({
    transactions: [{ id: 'paid', kind: 'bill-payment', paymentId: 'rent', amountMinor: 200_000, occurredAt: '2026-10-25T10:00:00+03:00' }],
  }));
  assert.equal(after.remainingBalanceMinor, 800_000);
  assert.equal(after.reservedPaymentsMinor, 0);
  assert.deepEqual(after.reservedPaymentIds, []);
  assert.equal(after.spendableMinor, before.spendableMinor);
  assert.equal(after.todayOutflowMinor, 200_000);
  assert.equal(after.todayBudgetImpactMinor, 0);
  assert.equal(after.daily?.todayRemainingMinor, before.daily?.todayRemainingMinor);
});

for (const [actual, impact, remaining] of [
  [250_000, 50_000, 20_000],
  [150_000, -50_000, 120_000],
] as const) {
  test(`bill amount ${actual}: only its difference from the reserve impacts today's target`, () => {
    const result = calculateBudget(budget({
      transactions: [{ id: 'paid', kind: 'bill-payment', paymentId: 'rent', amountMinor: actual, occurredAt: '2026-10-25T10:00:00+03:00' }],
    }));
    assert.equal(result.todayBudgetImpactMinor, impact);
    assert.equal(result.daily?.todayRemainingMinor, remaining);
    assert.equal(result.daily?.forwardDailyAverageMinor, 70_000);
  });
}

test('a discount on an underfunded bill cannot create more today money than exists', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 10_000, capturedAt: '2026-10-20T09:00:00+03:00' },
    payments: [{ id: 'rent', amountMinor: 20_000, dueOn: '2026-10-28' }],
    savingsTargetMinor: 0,
    transactions: [{ id: 'discounted', kind: 'bill-payment', paymentId: 'rent', amountMinor: 5_000, occurredAt: '2026-10-25T10:00:00+03:00' }],
  }));
  assert.equal(result.spendableAtDayStartMinor, -10_000);
  assert.equal(result.spendableMinor, 5_000);
  assert.equal(result.todayBudgetImpactMinor, -15_000);
  assert.equal(result.daily?.todayRemainingMinor, 5_000);
  assert.equal(result.daily?.forwardDailyAverageMinor, 0);
});

test('overdue bills are reserved but payday and later bills are excluded', () => {
  const result = calculateBudget(budget({
    payments: [
      { id: 'overdue', amountMinor: 10_000, dueOn: '2026-10-19' },
      { id: 'before', amountMinor: 20_000, dueOn: '2026-11-03' },
      { id: 'payday', amountMinor: 30_000, dueOn: '2026-11-04' },
      { id: 'after', amountMinor: 40_000, dueOn: '2026-11-05' },
    ],
  }));
  assert.equal(result.reservedPaymentsMinor, 30_000);
  assert.deepEqual(result.reservedPaymentIds, ['before', 'overdue']);
});

test('paying a bill not reserved for this period impacts spendable funds in full', () => {
  const result = calculateBudget(budget({
    payments: [{ id: 'later', amountMinor: 200_000, dueOn: '2026-11-04' }],
    transactions: [{ id: 'paid-early', kind: 'bill-payment', paymentId: 'later', amountMinor: 200_000, occurredAt: '2026-10-25T10:00:00+03:00' }],
  }));
  assert.equal(result.reservedPaymentsMinor, 0);
  assert.equal(result.todayBudgetImpactMinor, 200_000);
  assert.equal(result.daily?.todayRemainingMinor, -110_000);
});

test('a bill settled before the snapshot is neither reserved nor debited again', () => {
  const result = calculateBudget(budget({
    transactions: [{ id: 'old-payment', kind: 'bill-payment', paymentId: 'rent', amountMinor: 200_000, occurredAt: '2026-10-19T10:00:00+03:00' }],
  }));
  assert.equal(result.spentSinceSnapshotMinor, 0);
  assert.equal(result.remainingBalanceMinor, 1_000_000);
  assert.equal(result.reservedPaymentsMinor, 0);
  assert.equal(result.daily?.todayStartTargetMinor, 90_000);
});

test('a bill settled yesterday does not consume today target again', () => {
  const result = calculateBudget(budget({
    transactions: [{ id: 'yesterday-payment', kind: 'bill-payment', paymentId: 'rent', amountMinor: 200_000, occurredAt: '2026-10-24T10:00:00+03:00' }],
  }));
  assert.equal(result.remainingBalanceMinor, 800_000);
  assert.equal(result.spendableAtDayStartMinor, 700_000);
  assert.equal(result.todayBudgetImpactMinor, 0);
  assert.equal(result.daily?.todayRemainingMinor, 70_000);
});

test('opening snapshot includes all earlier, back-entered and exact-cutoff expenses', () => {
  const result = calculateBudget(budget({
    transactions: [
      { id: 'exact', kind: 'expense', amountMinor: 5_000, occurredAt: '2026-10-20T09:00:00+03:00' },
      { id: 'back-entered', kind: 'expense', amountMinor: 7_000, occurredAt: '2026-10-19T12:00:00+03:00' },
      { id: 'after', kind: 'expense', amountMinor: 3_000, occurredAt: '2026-10-20T09:00:00.001+03:00' },
    ],
  }));
  assert.equal(result.spentSinceSnapshotMinor, 3_000);
  assert.equal(result.remainingBalanceMinor, 997_000);
});

test('a midday initial snapshot does not subtract earlier purchases on that day', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 100_000, capturedAt: '2026-10-25T10:00:00+03:00' },
    payments: [], savingsTargetMinor: 0,
    transactions: [
      { id: 'included', kind: 'expense', amountMinor: 30_000, occurredAt: '2026-10-25T09:00:00+03:00' },
      { id: 'new', kind: 'expense', amountMinor: 5_000, occurredAt: '2026-10-25T11:00:00+03:00' },
    ],
  }));
  assert.equal(result.remainingBalanceMinor, 95_000);
  assert.equal(result.daily?.todayStartTargetMinor, 10_000);
  assert.equal(result.daily?.todayRemainingMinor, 5_000);
});

test('simulation is pure, repeatable and does not change frozen inputs or current results', () => {
  const input = deepFreeze(budget());
  const copy = structuredClone(input);
  const before = calculateBudget(input);
  const simulated = simulateExpense(input, 80_000);
  assert.deepEqual(input, copy);
  assert.deepEqual(calculateBudget(input), before);
  assert.deepEqual(simulated.current, before);
  assert.deepEqual(simulateExpense(input, 80_000), simulated);
  assert.equal(simulated.simulated.remainingBalanceMinor, 920_000);
  assert.equal(simulated.simulated.spendableMinor, 620_000);
  assert.equal(simulated.simulated.daily?.todayStartTargetMinor, 70_000);
  assert.equal(simulated.simulated.daily?.todayRemainingMinor, -10_000);
});

test('simulation works at the exact snapshot instant without inventing a future transaction', () => {
  const input = budget({ balanceSnapshot: { amountMinor: 1_000_000, capturedAt: '2026-10-25T12:00:00+03:00' } });
  const result = simulateExpense(input, 100);
  assert.equal(result.simulated.spentSinceSnapshotMinor, 100);
  assert.equal(result.simulated.todayOutflowMinor, 100);
});

test('simulation can show a deficit without an affordability promise', () => {
  const result = simulateExpense(budget(), 800_000);
  assert.equal(result.simulated.spendableMinor, -100_000);
  assert.equal(result.simulated.budgetDeficitMinor, 100_000);
  assert.equal(result.simulated.daily?.recommendedDailyMinor, 0);
});

test('input order does not change the financial result', () => {
  const input = budget({
    payments: [
      { id: 'z', amountMinor: 1_000, dueOn: '2026-10-28' },
      { id: 'a', amountMinor: 2_000, dueOn: '2026-10-29' },
    ],
    transactions: [
      { id: 'one', kind: 'expense', amountMinor: 123, occurredAt: '2026-10-25T10:00:00+03:00' },
      { id: 'two', kind: 'expense', amountMinor: 456, occurredAt: '2026-10-24T10:00:00+03:00' },
    ],
  });
  const reordered: BudgetInput = { ...input, payments: [...input.payments].reverse(), transactions: [...input.transactions].reverse() };
  assert.deepEqual(calculateBudget(input), calculateBudget(reordered));
});

test('integer kuruş allocation leaves the remainder undistributed', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 10_000, capturedAt: '2026-10-25T09:00:00+03:00' },
    nextPayday: '2026-10-28', payments: [], savingsTargetMinor: 0,
  }));
  assert.equal(result.daily?.recommendedDailyMinor, 3_333);
  assert.equal(result.daily?.uniformRemainderMinor, 1);
  assert.equal(result.daily?.todayStartTargetMinor, 3_333);
  assert.equal(result.daily?.forwardDailyAverageMinor, 3_333);
  assert.equal(result.daily?.forwardRemainderMinor, 1);
});

test('one kuruş over three days never allocates three kuruş', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: 1, capturedAt: '2026-10-20T09:00:00+03:00' },
    nextPayday: '2026-10-28', payments: [], savingsTargetMinor: 0,
  }));
  assert.equal(result.daily?.recommendedDailyMinor, 0);
  assert.equal(result.daily?.uniformRemainderMinor, 1);
});

test('maximum safe minor units preserve exact integer division', () => {
  const result = calculateBudget(budget({
    balanceSnapshot: { amountMinor: Number.MAX_SAFE_INTEGER, capturedAt: '2026-10-20T09:00:00+03:00' },
    nextPayday: '2026-11-01', payments: [], savingsTargetMinor: 0,
  }));
  assert.equal(result.daily?.recommendedDailyMinor, 1_286_742_750_677_284);
  assert.equal(result.daily?.uniformRemainderMinor, 3);
});

test('allocation conservation holds across deficits, cents, spending and large amounts', () => {
  for (const balance of [-100, 0, 1, 2, 99, 100, 10_001, Number.MAX_SAFE_INTEGER]) {
    for (const expense of [0, 1, 2, 99]) {
      const result = calculateBudget(budget({
        balanceSnapshot: { amountMinor: balance, capturedAt: '2026-10-20T09:00:00+03:00' },
        nextPayday: '2026-10-28', payments: [], savingsTargetMinor: 0,
        transactions: expense ? [{ id: 'spend', kind: 'expense', amountMinor: expense, occurredAt: '2026-10-25T10:00:00+03:00' }] : [],
      }));
      assert(result.periodStatus === 'active');
      const available = BigInt(Math.max(result.spendableMinor, 0));
      const daily = result.daily;
      assert.equal(BigInt(daily.recommendedDailyMinor) * 3n + BigInt(daily.uniformRemainderMinor), available);
      assert.equal(
        BigInt(Math.max(daily.todayRemainingMinor, 0)) + BigInt(daily.forwardDailyAverageMinor ?? 0) * 2n + BigInt(daily.forwardRemainderMinor),
        available,
      );
    }
  }
});
