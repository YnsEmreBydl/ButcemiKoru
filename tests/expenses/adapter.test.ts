import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareExpense, reconcileExpenseAttempt, type ExpenseDraft } from '../../src/features/expenses/adapter';
import { command } from '../storage/sqlite-helper';
import { add, cancel, fixture, now } from './fixtures';

const draft: ExpenseDraft = { amount: '123,45', category: 'food', description: '  Örnek açıklama  ' };
const context = { operationId: 'expense-op', occurredAt: '2026-10-25T08:00:00Z', createdAt: now, asOf: now };

test('Expense adapter: Turkish amount, category and trimmed description become a safe immutable command', async (t) => {
  const { saved } = await fixture(t);
  const prepared = prepareExpense(draft, saved, context);
  assert.equal(prepared.status, 'ready');
  if (prepared.status !== 'ready') throw new Error('Expected valid preparation');
  assert.equal(prepared.command.expense.amountMinor, 12345);
  assert.equal(prepared.command.expense.description, 'Örnek açıklama');
  assert.equal(prepared.command.expense.category, 'food');
  assert.equal(prepared.command.expectedRevision, saved.revision);
  assert.equal(prepared.command.expense.occurredAt, '2026-10-25T08:00:00.000Z');
  assert.equal(prepared.command.expense.createdAt, '2026-10-25T09:00:00.000Z');
  assert.equal(saved.expenses.length, 0);
});

for (const amount of ['0', '-1', '0,001', 'NaN', 'Infinity', '', '1e3', '12.34,56', '90071992547409,92']) {
  test(`Expense adapter: invalid amount ${JSON.stringify(amount)} is not saved`, async (t) => {
    const { saved } = await fixture(t);
    const result = prepareExpense({ ...draft, amount }, saved, context);
    assert.equal(result.status, 'invalid');
    if (result.status === 'invalid') assert(result.errors.amount);
  });
}

test('Expense adapter: empty optional description is allowed and overlong description is rejected', async (t) => {
  const { saved } = await fixture(t);
  assert.equal(prepareExpense({ ...draft, description: '' }, saved, context).status, 'ready');
  const invalid = prepareExpense({ ...draft, description: 'x'.repeat(201) }, saved, context);
  assert.equal(invalid.status, 'invalid');
  if (invalid.status === 'invalid') assert(invalid.errors.description);
});

test('Expense adapter: negative budget is allowed but arithmetic overflow and expired periods are not', async (t) => {
  const { saved } = await fixture(t);
  assert.equal(prepareExpense({ ...draft, amount: '8.000' }, saved, context).status, 'ready');
  const ended = prepareExpense(draft, saved, { ...context, asOf: '2026-11-04T09:00:00Z' });
  assert.equal(ended.status, 'invalid');
  const base = command();
  const { saved: negative } = await fixture(t, command({ input: { ...base.input, balanceSnapshot: { ...base.input.balanceSnapshot, amountMinor: Number.MIN_SAFE_INTEGER }, savingsTargetMinor: 0, payments: [] }, paymentNames: [] }));
  assert.equal(prepareExpense({ ...draft, amount: '0,01' }, negative, context).status, 'invalid');
});

test('Expense adapter: unknown category and invalid clock are visible errors', async (t) => {
  const { saved } = await fixture(t);
  const invalid = { ...draft }; Reflect.set(invalid, 'category', 'unknown');
  assert.equal(prepareExpense(invalid, saved, context).status, 'invalid');
  assert.equal(prepareExpense(draft, saved, { ...context, createdAt: 'invalid' }).status, 'invalid');
});

test('Expense adapter: uncertain acknowledgement distinguishes missing, committed and conflicting records', async (t) => {
  const { saved, repo } = await fixture(t);
  const prepared = prepareExpense(draft, saved, context);
  if (prepared.status !== 'ready') throw new Error('Expected valid preparation');
  assert.equal(reconcileExpenseAttempt(prepared.command, saved), 'missing');
  assert.equal(reconcileExpenseAttempt(prepared.command, null), 'missing');
  const committed = await repo.addExpense(prepared.command);
  assert.equal(reconcileExpenseAttempt(prepared.command, committed), 'saved');
  const corrected = await repo.cancelExpense(cancel({ expenseId: prepared.command.expense.id }));
  assert.equal(reconcileExpenseAttempt(prepared.command, corrected), 'saved');
  assert.equal(reconcileExpenseAttempt({ ...prepared.command, expense: { ...prepared.command.expense, amountMinor: 1 } }, committed), 'conflict');
});

test('Expense adapter: replay validation never modifies the original command or history', async (t) => {
  const { repo } = await fixture(t);
  const original = add(); const snapshot = structuredClone(original);
  await repo.addExpense(Object.freeze({ ...original, expense: Object.freeze({ ...original.expense }) }));
  assert.deepEqual(original, snapshot);
});
