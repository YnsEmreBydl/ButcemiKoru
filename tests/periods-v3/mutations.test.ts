import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateDatabase } from '../../src/data/budget/migrations';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { createBudgetRepositoryV3 } from '../../src/data/budget/repository-v3';
import type { CancelExpenseCommandV3 } from '../../src/data/budget/v3-contracts';
import { budget } from '../budget/fixtures';
import { legacyFixture, snapshot } from '../migrations-v3/fixtures';
import { databaseFixture } from '../storage/sqlite-helper';
import { add, beforePayday, edit, fixture, initial, payday, pid, scope, start } from './fixtures';

test('v3 repository: initial save is distinct from a transition and is idempotent', async t => {
  const db = databaseFixture(t).open(); await migrateDatabaseV3(db); const repo = createBudgetRepositoryV3(db);
  assert.equal(await repo.loadActivePeriod(1, beforePayday), null);
  const first = await repo.saveBudget(initial()); assert.equal(first.status, 'active'); assert.equal(first.revision, 1);
  assert.equal((await repo.loadBook(1)).activationRevision, 1); assert.deepEqual(await repo.saveBudget(initial()), first);
  const identity = await repo.newPublicId(); assert.match(identity, /^[a-f0-9]{32}$/);
  await assert.rejects(repo.saveBudget(initial({ operationId: 'another', expectedActivationRevision: 1 })), { code: 'ALREADY_EXISTS' });
  const before = snapshot(db);
  await assert.rejects(repo.saveBudget(initial({ input: { ...initial().input, savingsTargetMinor: 1 } })), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: no implicit migration or app opener is invoked on a v2 database', async t => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const before = snapshot(db);
  await assert.rejects(createBudgetRepositoryV3(db).loadBook(1), { code: 'MIGRATION' }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: active/closed reads validate exact local/public/book scopes', async t => {
  const { db, repo, active } = await fixture(t);
  await assert.rejects(repo.loadClosedPeriod(scope(active)), { code: 'CONFLICT' });
  await assert.rejects(repo.loadBook(999), { code: 'NOT_FOUND' });
  await assert.rejects(repo.loadBook(NaN), { code: 'INVALID_DATA' });
  const closed = (await repo.startPeriod(start(active))).source;
  await assert.rejects(repo.loadClosedPeriod({ ...scope(closed), periodId: 999 }), { code: 'NOT_FOUND' });
  await assert.rejects(repo.loadClosedPeriod({ ...scope(closed), periodPublicId: pid(777) }), { code: 'CONFLICT' });
  db.db.exec('INSERT INTO budget_books(id,activation_revision) VALUES(2,0)');
  await assert.rejects(repo.loadClosedPeriod({ ...scope(closed), bookId: 2 }), { code: 'NOT_FOUND' });
});

test('v3 repository: two books use actual auto IDs and never mix their invoices or expenses', async t => {
  const { db, repo, active } = await fixture(t); db.db.exec('INSERT INTO budget_books(id,activation_revision) VALUES(2,0)');
  const other = await repo.saveBudget(initial({ bookId: 2, operationId: 'book-two', input: budget({
    balanceSnapshot: { amountMinor: 987654, capturedAt: '2026-10-20T06:00:00.000Z' }, payments: [], savingsTargetMinor: 0,
  }), paymentNames: [] }));
  assert.equal(other.id, 2); assert.equal(other.bookId, 2);
  const transition = await repo.startPeriod(start(active)); assert.equal(transition.target.id, 3);
  assert.equal((await repo.loadActivePeriod(2, payday))?.result.remainingBalanceMinor, 987654);
  assert.equal((await repo.loadActivePeriod(2, payday))?.payments.length, 0);
  assert.equal((await repo.loadActivePeriod(1, payday))?.payments.length, 1);
  assert.equal((await repo.loadBook(2)).activationRevision, 1);
});

test('v3 repository: expense, one-time cancellation and receipts are scoped to B and preserve A', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const a = await repo.loadClosedPeriod(scope(active));
  const command = add(b); const spent = await repo.addExpense(command);
  assert.equal(spent.id, b.id); assert.equal(spent.result.remainingBalanceMinor, 290000); assert.equal(spent.revision, 2);
  assert.deepEqual(await repo.addExpense(command), spent);
  const cancel: CancelExpenseCommandV3 = { ...scope(b), operationId: 'cancel-b', expectedRevision: 2, expectedActivationRevision: 2,
    expenseId: command.expense.id, expensePublicId: command.expensePublicId,
    cancelledAt: '2026-11-05T09:30:00.000Z', asOf: '2026-11-05T10:00:00.000Z' };
  const cancelled = await repo.cancelExpense(cancel);
  assert.equal(cancelled.result.remainingBalanceMinor, 300000); assert.equal(cancelled.revision, 3);
  assert.equal(cancelled.expenses[0].status, 'cancelled'); assert.deepEqual(await repo.cancelExpense(cancel), cancelled);
  // Old add acknowledgement is safe after the cancellation and never reactivates the row.
  assert.equal((await repo.addExpense(command)).expenses[0].status, 'cancelled');
  await assert.rejects(repo.cancelExpense({ ...cancel, operationId: 'cancel-again', expectedRevision: 3 }), { code: 'ALREADY_CANCELLED' });
  assert.deepEqual(await repo.loadClosedPeriod(scope(active)), a);
  assert.equal(db.db.prepare('SELECT period_id FROM budget_expenses WHERE id=?').get(command.expense.id)?.period_id, b.id);
});

test('v3 repository: delayed old forms and wrong expense scopes are rejected without rerouting', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const before = snapshot(db); const expense = add(b);
  for (const request of [
    { ...expense, ...scope(active), expectedRevision: 5, expectedActivationRevision: 1 },
    { ...expense, ...scope(active), expectedRevision: 6, expectedActivationRevision: 2 },
    { ...expense, periodId: 999 }, { ...expense, periodPublicId: active.publicId },
  ]) await assert.rejects(repo.addExpense(request));
  const delayed = edit(active, { expectedActivationRevision: 2, input: { ...active.input, asOf: payday, transactions: [], nextPayday: '2026-12-04' } });
  await assert.rejects(repo.saveBudget(delayed), { code: 'CONFLICT' }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: saving an active carried invoice preserves its public ID and provenance', async t => {
  const { repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const command = edit(b, { input: { ...b.input, savingsTargetMinor: 10000 } });
  const saved = await repo.saveBudget(command);
  assert.equal(saved.revision, 2); assert.deepEqual(saved.payments, b.payments);
  assert.equal(saved.result.spendableMinor, 90000);
  assert.deepEqual(await repo.saveBudget(command), saved);
});

test('v3 repository: active invoice updates add/remove only scoped rows and remain parameterized', async t => {
  const { repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const name = "Fatura'); DROP TABLE budget_periods; --";
  const command = edit(b, { input: { ...b.input, payments: [{ id: 'new', amountMinor: 123, dueOn: '2026-11-20' }] }, paymentNames: [{ id: 'new', name }] });
  const saved = await repo.saveBudget(command); assert.equal(saved.payments.length, 1); assert.equal(saved.payments[0].name, name);
  assert.match(saved.payments[0].publicId, /^[a-f0-9]{32}$/);
  assert.equal((await repo.loadClosedPeriod(scope(active))).payments.length, 2);
});

test('v3 repository: save cannot revive an expired period by changing its payday', async t => {
  const db = databaseFixture(t).open(); await migrateDatabaseV3(db); const repo = createBudgetRepositoryV3(db);
  const a = await repo.saveBudget(initial()); if (a.status !== 'active') throw Error('fixture'); const before = snapshot(db);
  await assert.rejects(repo.saveBudget(edit(a, { expectedActivationRevision: 1, input: { ...a.input, asOf: payday, nextPayday: '2026-12-04' } })), { code: 'NEW_PERIOD_REQUIRED' });
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: opening edits stay locked with cancelled history and cannot import caller transactions', async t => {
  const { repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const expense = add(b); const spent = await repo.addExpense(expense);
  const cancelled = await repo.cancelExpense({ ...scope(b), operationId: 'cancel', expectedRevision: spent.revision, expectedActivationRevision: 2,
    expenseId: expense.expense.id, expensePublicId: expense.expensePublicId, cancelledAt: expense.asOf, asOf: expense.asOf });
  if (cancelled.status !== 'active') throw Error('fixture');
  await assert.rejects(repo.saveBudget(edit(cancelled, { input: { ...cancelled.input,
    balanceSnapshot: { ...cancelled.input.balanceSnapshot, amountMinor: 1 } } })), { code: 'BALANCE_LOCKED' });
  await assert.rejects(repo.saveBudget(edit(cancelled, { input: { ...cancelled.input,
    transactions: [{ id: 'forged', kind: 'expense', amountMinor: 1, occurredAt: cancelled.input.asOf }] } })), { code: 'INVALID_DATA' });
});

test('v3 repository: pre-snapshot, zero/fractional and expired-period expenses never debit a new period', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const before = snapshot(db);
  const base = add(b);
  for (const patch of [{ amountMinor: 0 }, { amountMinor: 0.1 }, { occurredAt: payday }]) {
    await assert.rejects(repo.addExpense({ ...base, expense: { ...base.expense, ...patch } }), { code: 'INVALID_DATA' });
  }
  await assert.rejects(repo.addExpense({ ...base, asOf: '2026-12-04T09:00:00.000Z' }), { code: 'NEW_PERIOD_REQUIRED' });
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: legacy receipt collision is a conflict, never an inferred successful v3 command', async t => {
  const { db, repo, active } = await fixture(t); const before = snapshot(db);
  await assert.rejects(repo.startPeriod(start(active, { operationId: 'kurulum-id' })), { code: 'CONFLICT' });
  await assert.rejects(repo.saveBudget(edit(active, { operationId: 'kurulum-id', expectedActivationRevision: 1 })), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: corrupted cancelled rows are validated, not excluded from data validation', async t => {
  const { db, repo } = await fixture(t); db.db.exec("DROP TRIGGER expense_protect_update; PRAGMA ignore_check_constraints=ON; UPDATE budget_expenses SET category='bad' WHERE status='cancelled'");
  const before = snapshot(db); await assert.rejects(repo.loadActivePeriod(1, beforePayday), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: full snapshot contract and calculation version are checked without rewriting archive', async t => {
  const { db, repo, active } = await fixture(t); await repo.startPeriod(start(active));
  db.db.exec('DROP TRIGGER period_protect_update');
  db.db.exec("UPDATE budget_periods SET closing_result_json=json_set(closing_result_json,'$.daysUntilPayday',99) WHERE id=1");
  let before = snapshot(db); await assert.rejects(repo.loadClosedPeriod(scope(active)), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
  db.db.exec("UPDATE budget_periods SET calculation_version='future-engine-v9' WHERE id=1");
  before = snapshot(db); await assert.rejects(repo.loadClosedPeriod(scope(active)), { code: 'UNSUPPORTED' }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: Turkish local payday boundary differs from UTC date and is respected', async t => {
  const { repo, active } = await fixture(t); const midnight = '2026-11-03T21:00:00.000Z';
  const result = await repo.startPeriod(start(active, { balanceCapturedAt: midnight, asOf: midnight }));
  assert.equal(result.source.result.today, '2026-11-04'); assert.equal(result.source.result.periodStatus, 'payday-today');
  assert.equal(result.target.result.daysUntilPayday, 30);
});

test('v3 repository: DST transition uses local calendar days, never 24-hour elapsed division', async t => {
  const db = databaseFixture(t).open(); await migrateDatabaseV3(db); const repo = createBudgetRepositoryV3(db);
  const source = await repo.saveBudget(initial({ input: budget({ timeZone: 'America/New_York', nextPayday: '2026-11-01' }) }));
  if (source.status !== 'active') throw Error('fixture');
  const instant = '2026-11-01T04:00:00.000Z';
  const result = await repo.startPeriod(start(source, { balanceCapturedAt: instant, asOf: instant, nextPayday: '2026-12-01', carryPayments: [] }));
  assert.equal(result.source.result.today, '2026-11-01'); assert.equal(result.target.result.daysUntilPayday, 30);
  assert.equal(result.target.input.timeZone, 'America/New_York');
});

test('v3 repository: old expense/cancel/save acknowledgements return their recorded closed B, never active C', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const addition = add(b); const spent = await repo.addExpense(addition);
  const cancellation: CancelExpenseCommandV3 = { ...scope(b), operationId: 'cancel-before-close', expectedRevision: spent.revision,
    expectedActivationRevision: 2, expenseId: addition.expense.id, expensePublicId: addition.expensePublicId,
    cancelledAt: addition.asOf, asOf: addition.asOf };
  const cancelled = await repo.cancelExpense(cancellation); if (cancelled.status !== 'active') throw Error('fixture');
  const editing = edit(cancelled, { input: { ...cancelled.input, savingsTargetMinor: 1 } });
  const edited = await repo.saveBudget(editing); if (edited.status !== 'active') throw Error('fixture');
  const c = await repo.startPeriod(start(edited, { operationId: 'b-to-c', expectedActivationRevision: 2,
    newPeriodPublicId: pid(3), balanceCapturedAt: '2026-12-04T09:00:00.000Z', asOf: '2026-12-04T09:00:00.000Z', nextPayday: '2027-01-04', carryPayments: [] }));
  const before = snapshot(db);
  for (const result of [await repo.addExpense(addition), await repo.cancelExpense(cancellation), await repo.saveBudget(editing)]) {
    assert.equal(result.id, b.id); assert.equal(result.status, 'closed'); assert.equal(result.expenses[0].status, 'cancelled');
  }
  assert.deepEqual(snapshot(db), before); assert.equal((await repo.loadActivePeriod(1, c.target.input.asOf))?.id, c.target.id);
});

test('v3 repository: valid long legacy invoice identity can be carried without altering its source', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2); const longId = 'eski-fatura-'.repeat(20);
  db.db.prepare('UPDATE budget_payments SET id=? WHERE id=?').run(longId, 'rent'); await migrateDatabaseV3(db);
  const repo = createBudgetRepositoryV3(db), active = await repo.loadActivePeriod(1, beforePayday);
  if (!active) throw Error('fixture'); const bill = active.payments.find(row => row.id === longId); if (!bill) throw Error('fixture');
  const result = await repo.startPeriod(start(active, { carryPayments: [{ sourcePaymentId: longId, sourcePaymentPublicId: bill.publicId,
    newId: 'b-long-copy', newPublicId: pid(200), dueOn: '2026-11-28' }] }));
  assert.equal(result.target.payments[0].carriedFrom?.paymentId, longId);
  assert.ok(result.source.payments.some(row => row.id === longId));
});
