import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BudgetInputError, calendarDateAt, calendarDaysBetween, calculateBudget } from '../../src/domain/budget';

import { budget } from './fixtures';

for (const [from, to, expected] of [
  ['2025-01-31', '2025-02-01', 1],
  ['2025-01-31', '2025-03-01', 29],
  ['2025-04-30', '2025-05-01', 1],
  ['2024-02-28', '2024-03-01', 2],
  ['2025-02-28', '2025-03-01', 1],
  ['2000-02-28', '2000-03-01', 2],
  ['1900-02-28', '1900-03-01', 1],
  ['2026-12-31', '2027-01-01', 1],
  ['2026-10-25', '2026-10-25', 0],
  ['2026-10-25', '2026-10-24', -1],
  ['0001-01-01', '0002-01-01', 365],
] as const) {
  test(`calendar days: ${from} → ${to} = ${expected}`, () => {
    assert.equal(calendarDaysBetween(from, to), expected);
  });
}

test('local calendar date uses the explicit zone rather than the UTC date', () => {
  assert.equal(calendarDateAt('2026-10-24T21:30:00Z', 'Europe/Istanbul'), '2026-10-25');
  assert.equal(calendarDateAt('2026-10-24T18:30:00Z', 'Asia/Kathmandu'), '2026-10-25');
  assert.equal(calendarDateAt('2026-10-25T00:30:00+03:00', 'Europe/Istanbul'), '2026-10-25');
});

for (const [label, capturedAt, asOf, nextPayday, today] of [
  ['spring 23-hour day', '2026-03-07T12:00:00-05:00', '2026-03-09T03:30:00Z', '2026-03-09', '2026-03-08'],
  ['autumn 25-hour day', '2026-10-31T12:00:00-04:00', '2026-11-02T04:30:00Z', '2026-11-02', '2026-11-01'],
] as const) {
  test(`DST: ${label} still leaves exactly one local calendar day`, () => {
    const result = calculateBudget(budget({
      timeZone: 'America/New_York',
      asOf,
      balanceSnapshot: { amountMinor: 10_000, capturedAt },
      nextPayday,
      payments: [],
      savingsTargetMinor: 0,
    }));
    assert.equal(result.today, today);
    assert.equal(result.daysUntilPayday, 1);
    assert.equal(result.daily?.todayStartTargetMinor, 10_000);
    assert.equal(result.daily?.forwardDailyAverageMinor, null);
  });
}

test('both occurrences of the repeated DST hour are counted on the same local day', () => {
  const result = calculateBudget(budget({
    timeZone: 'America/New_York',
    asOf: '2026-11-01T12:00:00-05:00',
    balanceSnapshot: { amountMinor: 100_000, capturedAt: '2026-10-31T12:00:00-04:00' },
    nextPayday: '2026-11-03',
    payments: [],
    savingsTargetMinor: 0,
    transactions: [
      { id: 'first', kind: 'expense', amountMinor: 5_000, occurredAt: '2026-11-01T01:30:00-04:00' },
      { id: 'second', kind: 'expense', amountMinor: 7_000, occurredAt: '2026-11-01T01:30:00-05:00' },
    ],
  }));
  assert.equal(result.todayOutflowMinor, 12_000);
  assert.equal(result.remainingBalanceMinor, 88_000);
  assert.equal(result.daily?.todayStartTargetMinor, 50_000);
  assert.equal(result.daily?.todayRemainingMinor, 38_000);
});

test('expenses around local midnight are allocated to different budget days', () => {
  const result = calculateBudget(budget({
    asOf: '2026-10-25T00:30:00+03:00',
    balanceSnapshot: { amountMinor: 1_000_000, capturedAt: '2026-10-24T12:00:00+03:00' },
    nextPayday: '2026-10-26',
    payments: [],
    savingsTargetMinor: 0,
    transactions: [
      { id: 'yesterday', kind: 'expense', amountMinor: 10_000, occurredAt: '2026-10-24T20:59:00Z' },
      { id: 'today', kind: 'expense', amountMinor: 20_000, occurredAt: '2026-10-24T21:05:00Z' },
    ],
  }));
  assert.equal(result.today, '2026-10-25');
  assert.equal(result.spentSinceSnapshotMinor, 30_000);
  assert.equal(result.todayOutflowMinor, 20_000);
  assert.equal(result.spendableAtDayStartMinor, 990_000);
  assert.equal(result.daily?.todayStartTargetMinor, 990_000);
  assert.equal(result.daily?.todayRemainingMinor, 970_000);
});

for (const invalid of ['2025-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '26-01-01', '2026-1-01', '2026-10-25T00:00:00Z']) {
  test(`invalid calendar date is rejected: ${invalid}`, () => {
    assert.throws(() => calendarDaysBetween('2026-01-01', invalid), BudgetInputError);
  });
}

test('local dates outside the supported Gregorian range are rejected', () => {
  assert.throws(() => calendarDateAt('0001-01-01T00:00:00+01:00', 'UTC'), { code: 'INVALID_DATE' });
  assert.throws(() => calendarDateAt('9999-12-31T23:59:59Z', 'Pacific/Kiritimati'), { code: 'INVALID_DATE' });
});
