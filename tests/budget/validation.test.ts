import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BudgetInputError, calculateBudget, simulateExpense, type BudgetInput } from '../../src/domain/budget';

import { budget } from './fixtures';

function rejects(value: unknown, code: string) {
  assert.throws(() => calculateBudget(value as BudgetInput), (error: unknown) => {
    assert(error instanceof BudgetInputError);
    assert.equal(error.code, code);
    assert(error.field.length > 0);
    return true;
  });
}

test('missing input, required fields, records and arrays are rejected', () => {
  for (const input of [undefined, null, [], 123]) rejects(input, 'INVALID_INPUT');
  for (const field of ['asOf', 'timeZone', 'balanceSnapshot', 'nextPayday', 'payments', 'savingsTargetMinor', 'transactions', 'currency'] as const) {
    const input: Record<string, unknown> = { ...budget() };
    delete input[field];
    assert.throws(() => calculateBudget(input as BudgetInput), BudgetInputError);
  }
  rejects(budget({ transactions: [null] } as unknown as Partial<BudgetInput>), 'INVALID_INPUT');
  rejects(budget({ payments: [null] } as unknown as Partial<BudgetInput>), 'INVALID_INPUT');
  rejects({ ...budget(), payments: {} }, 'INVALID_INPUT');
  rejects({ ...budget(), transactions: {} }, 'INVALID_INPUT');
});

for (const value of [undefined, null, NaN, Infinity, -Infinity, 0.5, '100', true, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid monetary input is rejected in every monetary field: ${String(value)}`, () => {
    rejects({ ...budget(), balanceSnapshot: { amountMinor: value, capturedAt: budget().balanceSnapshot.capturedAt } }, 'INVALID_MONEY');
    rejects({ ...budget(), savingsTargetMinor: value }, 'INVALID_MONEY');
    rejects({ ...budget(), payments: [{ id: 'x', dueOn: '2026-10-26', amountMinor: value }] }, 'INVALID_MONEY');
    rejects({ ...budget(), transactions: [{ id: 'x', kind: 'expense', occurredAt: budget().asOf, amountMinor: value }] }, 'INVALID_MONEY');
    assert.throws(() => simulateExpense(budget(), value as number), { code: 'INVALID_MONEY' });
  });
}

test('negative opening balances are supported, negative reserves and nonpositive debits are not', () => {
  const result = calculateBudget(budget({ balanceSnapshot: { amountMinor: -1, capturedAt: budget().balanceSnapshot.capturedAt } }));
  assert.equal(result.remainingBalanceMinor, -1);
  rejects(budget({ savingsTargetMinor: -1 }), 'INVALID_MONEY');
  for (const amountMinor of [0, -1]) {
    rejects(budget({ payments: [{ id: 'x', dueOn: '2026-10-26', amountMinor }] }), 'INVALID_MONEY');
    rejects(budget({ transactions: [{ id: 'x', kind: 'expense', amountMinor, occurredAt: budget().asOf }] }), 'INVALID_MONEY');
    assert.throws(() => simulateExpense(budget(), amountMinor), { code: 'INVALID_MONEY' });
  }
});

for (const asOf of ['2026-10-25T12:00:00', '2026-10-25', '2026-10-25T24:00:00Z', '2026-10-25T12:60:00Z', '2026-10-25T12:00:60Z', '2026-10-25T12:00:00.0001Z', '2026-10-25T12:00:00-00:00', '2026-10-25T12:00:00+24:00']) {
  test(`ambiguous or invalid instant is rejected: ${asOf}`, () => {
    rejects({ ...budget(), asOf }, 'INVALID_INSTANT');
  });
}

test('invalid timestamp dates are rejected rather than normalized by Date.parse', () => {
  rejects({ ...budget(), asOf: '2026-02-30T12:00:00Z' }, 'INVALID_DATE');
});

test('invalid time zones and unsupported currencies are rejected', () => {
  for (const timeZone of ['', 'Mars/Olympus', ' Europe/Istanbul', '+03:00', null, 3]) {
    rejects({ ...budget(), timeZone }, 'INVALID_TIME_ZONE');
  }
  for (const currency of ['USD', 'try', 'TRY ', '__proto__', 'constructor', null, 3]) {
    rejects({ ...budget(), currency }, 'UNSUPPORTED_CURRENCY');
  }
});

test('future snapshots and future actual transactions are rejected', () => {
  rejects(budget({ balanceSnapshot: { amountMinor: 100, capturedAt: '2026-10-25T13:00:00+03:00' } }), 'INVALID_CHRONOLOGY');
  rejects(budget({ transactions: [{ id: 'future', kind: 'expense', amountMinor: 100, occurredAt: '2026-10-25T13:00:00+03:00' }] }), 'INVALID_CHRONOLOGY');
});

test('duplicate transaction IDs and duplicate bill definitions are rejected', () => {
  const transaction = { id: 'same', kind: 'expense' as const, amountMinor: 1, occurredAt: budget().asOf };
  rejects(budget({ transactions: [transaction, transaction] }), 'DUPLICATE_ID');
  const payment = { id: 'same', amountMinor: 1, dueOn: '2026-10-26' };
  rejects(budget({ payments: [payment, payment] }), 'DUPLICATE_ID');
});

test('the same bill cannot be settled twice even using different transaction IDs', () => {
  rejects(budget({ transactions: [
    { id: 'one', kind: 'bill-payment', paymentId: 'rent', amountMinor: 200_000, occurredAt: '2026-10-24T10:00:00+03:00' },
    { id: 'two', kind: 'bill-payment', paymentId: 'rent', amountMinor: 200_000, occurredAt: '2026-10-25T10:00:00+03:00' },
  ] }), 'DUPLICATE_PAYMENT');
});

test('unknown bills, missing bill IDs and mislabeled bill transactions are rejected', () => {
  rejects(budget({ transactions: [{ id: 'x', kind: 'bill-payment', paymentId: 'unknown', amountMinor: 100, occurredAt: budget().asOf }] }), 'UNKNOWN_PAYMENT');
  rejects({ ...budget(), transactions: [{ id: 'x', kind: 'bill-payment', amountMinor: 100, occurredAt: budget().asOf }] }, 'INVALID_INPUT');
  rejects({ ...budget(), transactions: [{ id: 'x', kind: 'expense', paymentId: 'rent', amountMinor: 100, occurredAt: budget().asOf }] }, 'INVALID_INPUT');
  rejects({ ...budget(), transactions: [{ id: 'x', kind: 'income', amountMinor: 100, occurredAt: budget().asOf }] }, 'INVALID_INPUT');
});

test('empty and untrimmed identifiers are rejected', () => {
  for (const id of ['', ' ', ' x', null]) {
    rejects({ ...budget(), transactions: [{ id, kind: 'expense', amountMinor: 1, occurredAt: budget().asOf }] }, 'INVALID_INPUT');
    rejects({ ...budget(), payments: [{ id, amountMinor: 1, dueOn: '2026-10-26' }] }, 'INVALID_INPUT');
  }
});

test('aggregate expense overflow is detected before returning imprecise money', () => {
  rejects(budget({ transactions: [
    { id: 'large', kind: 'expense', amountMinor: Number.MAX_SAFE_INTEGER, occurredAt: budget().asOf },
    { id: 'one', kind: 'expense', amountMinor: 1, occurredAt: budget().asOf },
  ] }), 'AMOUNT_OVERFLOW');
});

test('reserve overflow and negative balance overflow are rejected', () => {
  rejects(budget({ payments: [
    { id: 'large', amountMinor: Number.MAX_SAFE_INTEGER, dueOn: '2026-10-26' },
    { id: 'one', amountMinor: 1, dueOn: '2026-10-26' },
  ] }), 'AMOUNT_OVERFLOW');
  rejects(budget({
    balanceSnapshot: { amountMinor: -Number.MAX_SAFE_INTEGER, capturedAt: budget().balanceSnapshot.capturedAt },
    payments: [], savingsTargetMinor: 0,
    transactions: [{ id: 'one', kind: 'expense', amountMinor: 1, occurredAt: budget().asOf }],
  }), 'AMOUNT_OVERFLOW');
});
