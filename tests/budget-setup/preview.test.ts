import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSetupPreview } from '../../src/features/budget-setup/preview';
import { emptySetupDraft, type PreviewContext, type SetupDraft } from '../../src/features/budget-setup/types';
import { deepFreeze } from '../budget/fixtures';

const context: PreviewContext = { asOf: '2026-10-25T12:00:00+03:00', timeZone: 'Europe/Istanbul' };

function draft(overrides: Partial<SetupDraft> = {}): SetupDraft {
  return { balance: '15.000,50', payday: '04.11.2026', savings: '1.000', payments: [], ...overrides };
}

test('form strings become the existing domain contract without mixing in salary or DEMO expenses', () => {
  const outcome = createSetupPreview(draft({
    payments: [{ id: 'one', name: 'Elektrik', amount: '2.000,00', dueDate: '28.10.2026' }],
  }), context);
  assert.equal(outcome.status, 'ready');
  if (outcome.status !== 'ready') return;
  assert.equal(outcome.input.balanceSnapshot.amountMinor, 1500050);
  assert.equal(outcome.input.asOf, context.asOf);
  assert.equal(outcome.input.balanceSnapshot.capturedAt, outcome.input.asOf);
  assert.equal(outcome.input.nextPayday, '2026-11-04');
  assert.equal(outcome.input.timeZone, 'Europe/Istanbul');
  assert.equal(outcome.input.savingsTargetMinor, 100000);
  assert.deepEqual(outcome.input.transactions, []);
  assert.deepEqual(outcome.input.payments, [{ id: 'one', amountMinor: 200000, dueOn: '2026-10-28' }]);
  assert.equal(outcome.result.remainingBalanceMinor, 1500050);
  assert.equal(outcome.result.spendableMinor, 1200050);
  assert.equal(outcome.result.daysUntilPayday, 10);
  assert.equal(outcome.result.daily?.recommendedDailyMinor, 120005);
});

test('optional blank savings and an empty bill list are valid', () => {
  const outcome = createSetupPreview(draft({ savings: '   ' }), context);
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') {
    assert.equal(outcome.input.savingsTargetMinor, 0);
    assert.deepEqual(outcome.input.payments, []);
  }
});

test('required blank fields are not silently converted to zero', () => {
  const outcome = createSetupPreview(emptySetupDraft(), context);
  assert.equal(outcome.status, 'invalid');
  if (outcome.status === 'invalid') {
    assert(outcome.errors.balance);
    assert(outcome.errors.payday);
  }
});

test('zero balance is accepted and negative balance is preserved with a deficit', () => {
  for (const balance of ['0', '-100,50']) {
    const outcome = createSetupPreview(draft({ balance, savings: '' }), context);
    assert.equal(outcome.status, 'ready');
    if (outcome.status === 'ready') {
      assert.equal(outcome.result.spendableMinor, balance === '0' ? 0 : -10050);
      assert.equal(outcome.result.budgetDeficitMinor, balance === '0' ? 0 : 10050);
      assert.equal(outcome.result.daily?.recommendedDailyMinor, 0);
    }
  }
});

test('negative savings and nonpositive bill amounts are rejected in their fields', () => {
  const savings = createSetupPreview(draft({ savings: '-1' }), context);
  assert.equal(savings.status, 'invalid');
  if (savings.status === 'invalid') assert(savings.errors.savings);
  for (const amount of ['0', '-1', '1,234']) {
    const outcome = createSetupPreview(draft({ payments: [{ id: 'one', name: 'Fatura', amount, dueDate: '28.10.2026' }] }), context);
    assert.equal(outcome.status, 'invalid');
    if (outcome.status === 'invalid') assert(outcome.errors.payments[0].amount);
  }
});

test('a partially filled added bill must be completed or removed', () => {
  const outcome = createSetupPreview(draft({ payments: [{ id: 'one', name: '', amount: '', dueDate: '' }] }), context);
  assert.equal(outcome.status, 'invalid');
  if (outcome.status === 'invalid') {
    assert(outcome.errors.payments[0].name);
    assert(outcome.errors.payments[0].amount);
    assert(outcome.errors.payments[0].dueDate);
  }
});

test('bill names are required and limited to 80 characters', () => {
  for (const name of ['   ', 'a'.repeat(81)]) {
    const outcome = createSetupPreview(draft({ payments: [{ id: 'one', name, amount: '1', dueDate: '28.10.2026' }] }), context);
    assert.equal(outcome.status, 'invalid');
    if (outcome.status === 'invalid') assert(outcome.errors.payments[0].name);
  }
});

test('same-day or later bill dates cannot be silently excluded in an active period', () => {
  for (const dueDate of ['04.11.2026', '05.11.2026']) {
    const outcome = createSetupPreview(draft({ payments: [{ id: 'one', name: 'Fatura', amount: '500', dueDate }] }), context);
    assert.equal(outcome.status, 'invalid');
    if (outcome.status === 'invalid') assert(outcome.errors.payments[0].dueDate);
  }
});

test('overdue but unpaid bills are reserved', () => {
  const outcome = createSetupPreview(draft({ payments: [{ id: 'one', name: 'Gecikmiş', amount: '500', dueDate: '24.10.2026' }] }), context);
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') assert.equal(outcome.result.reservedPaymentsMinor, 50000);
});

test('a valid zero savings target is retained', () => {
  const outcome = createSetupPreview(draft({ savings: '0,00' }), context);
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') assert.equal(outcome.input.savingsTargetMinor, 0);
});

test('payday today and past payday return a new-period preview without rolling dates', () => {
  for (const [payday, status, days] of [['25.10.2026', 'payday-today', 0], ['24.10.2026', 'payday-passed', -1]] as const) {
    const outcome = createSetupPreview(draft({ payday, payments: [{ id: 'one', name: 'Fatura', amount: '500', dueDate: '28.10.2026' }] }), context);
    assert.equal(outcome.status, 'ready');
    if (outcome.status === 'ready') {
      assert.equal(outcome.result.periodStatus, status);
      assert.equal(outcome.result.requiresNewPeriod, true);
      assert.equal(outcome.result.daysUntilPayday, days);
      assert.equal(outcome.result.daily, null);
      assert.equal(outcome.input.nextPayday, payday === '25.10.2026' ? '2026-10-25' : '2026-10-24');
    }
  }
});

test('local-day and DST behavior comes from the existing domain engine', () => {
  const outcome = createSetupPreview(draft({ balance: '100', savings: '', payday: '09.03.2026' }), {
    asOf: '2026-03-09T03:30:00Z', timeZone: 'America/New_York',
  });
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') {
    assert.equal(outcome.result.today, '2026-03-08');
    assert.equal(outcome.result.daysUntilPayday, 1);
  }
});

test('combined reserves above the balance are shown as a deficit rather than rejected', () => {
  const outcome = createSetupPreview(draft({ balance: '100', savings: '200' }), context);
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') {
    assert.equal(outcome.result.spendableMinor, -10000);
    assert.equal(outcome.result.budgetDeficitMinor, 10000);
  }
});

test('invalid date and excess precision create field errors', () => {
  const outcome = createSetupPreview(draft({ balance: '1,234', payday: '31.02.2026', savings: '5,555' }), context);
  assert.equal(outcome.status, 'invalid');
  if (outcome.status === 'invalid') {
    assert(outcome.errors.balance);
    assert(outcome.errors.payday);
    assert(outcome.errors.savings);
  }
});

test('aggregate monetary overflow is translated to a form error', () => {
  const outcome = createSetupPreview(draft({
    balance: '0', savings: '', payments: [
      { id: 'one', name: 'Bir', amount: '90071992547409,91', dueDate: '28.10.2026' },
      { id: 'two', name: 'İki', amount: '0,01', dueDate: '29.10.2026' },
    ],
  }), context);
  assert.equal(outcome.status, 'invalid');
  if (outcome.status === 'invalid') assert(outcome.errors.general?.includes('sınır'));
});

test('duplicate or invalid bill row IDs are rejected before calculation', () => {
  const row = { id: 'same', name: 'Fatura', amount: '1', dueDate: '28.10.2026' };
  for (const payments of [[row, row], [{ ...row, id: ' ' }]]) {
    const outcome = createSetupPreview(draft({ payments }), context);
    assert.equal(outcome.status, 'invalid');
    if (outcome.status === 'invalid') assert(outcome.errors.general);
  }
});

test('clock and time-zone errors are visible, never replaced with an implicit UTC fallback', () => {
  for (const badContext of [
    { ...context, timeZone: 'Mars/Olympus' },
    { ...context, asOf: '2026-10-25T12:00:00' },
  ]) {
    const outcome = createSetupPreview(draft(), badContext);
    assert.equal(outcome.status, 'invalid');
    if (outcome.status === 'invalid') assert(outcome.errors.general?.includes('saat'));
  }
});

test('the adapter leaves frozen drafts and contexts unchanged', () => {
  const input = deepFreeze(draft({ payments: [{ id: 'one', name: 'Fatura', amount: '500', dueDate: '28.10.2026' }] }));
  const clock = deepFreeze({ ...context });
  const original = structuredClone(input);
  const first = createSetupPreview(input, clock);
  const second = createSetupPreview(input, clock);
  assert.deepEqual(first, second);
  assert.deepEqual(input, original);
  assert.deepEqual(clock, context);
});
