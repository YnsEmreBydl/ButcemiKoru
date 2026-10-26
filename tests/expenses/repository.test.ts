import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtomicDatabase, ExpenseData } from '../../src/data/budget/contracts';
import { createBudgetRepository } from '../../src/data/budget/repository';
import { migrateDatabase } from '../../src/data/budget/migrations';
import { prepareBudgetSave, savedBudgetToDraft } from '../../src/features/budget-setup/persistence';
import { command, databaseFixture } from '../storage/sqlite-helper';
import { add, cancel, fixture, now } from './fixtures';

test('Expense SQLite: normal expense updates balance, daily average and today target independently', async (t) => {
  const { repo } = await fixture(t);
  const saved = await repo.addExpense(add());
  assert.equal(saved.revision, 2);
  assert.equal(saved.result.remainingBalanceMinor, 990000);
  assert.equal(saved.result.spendableMinor, 690000);
  assert.equal(saved.result.periodStatus, 'active');
  if (saved.result.periodStatus !== 'active') throw new Error('Expected active budget');
  assert.deepEqual(saved.result.daily, { recommendedDailyMinor: 69000, todayStartTargetMinor: 70000, todayRemainingMinor: 60000, forwardDailyAverageMinor: 70000, daysAfterToday: 9, uniformRemainderMinor: 0, forwardRemainderMinor: 0 });
  assert.equal(saved.expenses[0].status, 'active');
  assert.equal(saved.input.transactions[0].kind, 'expense');
});

test('Expense SQLite: multiple expenses keep today opening target stable', async (t) => {
  const { repo } = await fixture(t);
  await repo.addExpense(add({ expense: { ...add().expense, amountMinor: 50000 } }));
  const saved = await repo.addExpense(add({ operationId: 'two-op', expectedRevision: 2, expense: { ...add().expense, id: 'two', occurredAt: '2026-10-25T08:30:00Z' } }));
  if (saved.result.periodStatus !== 'active') throw new Error('Expected active budget');
  assert.equal(saved.result.daily.todayStartTargetMinor, 70000);
  assert.equal(saved.result.daily.todayRemainingMinor, 10000);
  assert.equal(saved.result.daily.recommendedDailyMinor, 64000);
  assert.equal(saved.expenses[0].id, 'two');
});

test('Expense SQLite: simultaneous duplicate taps and durable retry create one expense', async (t) => {
  const { repo, db, files } = await fixture(t);
  const [a,b] = await Promise.all([repo.addExpense(add()), repo.addExpense(add())]);
  assert.deepEqual(a,b); db.close();
  const reopened = createBudgetRepository(files.open());
  assert.equal((await reopened.addExpense(add())).revision, 2);
  assert.equal((await reopened.load(now))?.expenses.length, 1);
});

test('Expense SQLite: duplicate identity, conflicting payload and shared operation namespace are rejected', async (t) => {
  const { repo } = await fixture(t);
  await assert.rejects(repo.addExpense(add({ operationId: 'create-1' })), { code: 'CONFLICT' });
  await repo.addExpense(add());
  await assert.rejects(repo.addExpense(add({ operationId: 'other-op', expectedRevision: 2 })), { code: 'ALREADY_EXISTS' });
  await assert.rejects(repo.addExpense(add({ expense: { ...add().expense, amountMinor: 1 } })), { code: 'CONFLICT' });
  assert.equal((await repo.load(now))?.revision, 2);
});

test('Expense SQLite: failure after expense insertion rolls back expense, receipt and revision', async (t) => {
  const { repo, db, saved } = await fixture(t);
  db.db.exec("CREATE TRIGGER injected BEFORE INSERT ON budget_save_operations WHEN NEW.operation_id='expense-op' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
  await assert.rejects(repo.addExpense(add()));
  assert.deepEqual(await repo.load(saved.input.asOf), saved);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_expenses').get()?.n, 0);
  db.db.exec('DROP TRIGGER injected');
  assert.equal((await repo.addExpense(add())).revision, 2);
});

test('Expense SQLite: cancellation reverses the expense without deleting history', async (t) => {
  const { repo, saved } = await fixture(t);
  await repo.addExpense(add());
  const after = await repo.cancelExpense(cancel());
  assert.equal(after.revision, 3);
  assert.deepEqual(after.result, { ...saved.result, timeZone: saved.result.timeZone });
  assert.deepEqual(after.input.transactions, []);
  assert.equal(after.expenses.length, 1);
  assert.equal(after.expenses[0].status, 'cancelled');
  assert.equal(after.expenses[0].cancelledAt, new Date(now).toISOString());
});

test('Expense SQLite: cancellation retry is idempotent and another cancellation cannot refund twice', async (t) => {
  const { repo } = await fixture(t); await repo.addExpense(add());
  const [a,b] = await Promise.all([repo.cancelExpense(cancel()), repo.cancelExpense(cancel())]);
  assert.equal(a.revision, 3); assert.deepEqual(a,b);
  await assert.rejects(repo.cancelExpense(cancel({ operationId: 'another-cancel', expectedRevision: 3 })), { code: 'ALREADY_CANCELLED' });
  // A delayed add retry must return the cancelled row, never reactivate it.
  assert.equal((await repo.addExpense(add())).expenses[0].status, 'cancelled');
});

test('Expense SQLite: cancellation SQL failure keeps the original active expense and totals', async (t) => {
  const { repo, db } = await fixture(t); const before = await repo.addExpense(add());
  db.db.exec("CREATE TRIGGER injected BEFORE INSERT ON budget_save_operations WHEN NEW.operation_id='cancel-op' BEGIN SELECT RAISE(ABORT,'injected cancellation failure'); END");
  await assert.rejects(repo.cancelExpense(cancel()));
  assert.deepEqual(await repo.load(now), before);
});

test('Expense SQLite: cancelled history survives closing and reopening the database', async (t) => {
  const { repo, db, files } = await fixture(t); await repo.addExpense(add());
  const expected = await repo.cancelExpense(cancel()); db.close();
  const reopened = files.open(); await migrateDatabase(reopened);
  assert.deepEqual(await createBudgetRepository(reopened).load(now), expected);
});

test('Expense SQLite: a lost cancellation acknowledgement does not restore money twice', async (t) => {
  const { repo, db } = await fixture(t); await repo.addExpense(add());
  let fail = true;
  const gateway: AtomicDatabase = { async transaction(task) { const result = await db.transaction(task); if (fail) { fail=false; throw new Error('lost cancellation acknowledgement'); } return result; } };
  await assert.rejects(createBudgetRepository(gateway).cancelExpense(cancel()));
  const recovered = await repo.cancelExpense(cancel());
  assert.equal(recovered.revision, 3); assert.equal(recovered.result.spendableMinor, 700000);
});

test('Expense SQLite: queued input is captured before the caller can mutate it', async (t) => {
  const { repo } = await fixture(t);
  const input = add(); const pending = repo.addExpense(input);
  Reflect.set(input.expense, 'amountMinor', 1);
  Reflect.set(input.expense, 'description', 'later mutation');
  const saved = await pending;
  assert.equal(saved.expenses[0].amountMinor, 10000);
  assert.equal(saved.expenses[0].description, '');
});

test('Expense SQLite: acknowledged loss recovers the same durable expense rather than duplicating', async (t) => {
  const { db } = await fixture(t);
  let fail = true;
  const gateway: AtomicDatabase = { async transaction(task) { const result = await db.transaction(task); if(fail) { fail=false; throw new Error('injected acknowledgement loss'); } return result; } };
  await assert.rejects(createBudgetRepository(gateway).addExpense(add()));
  const recovered = await createBudgetRepository(db).addExpense(add());
  assert.equal(recovered.revision, 2); assert.equal(recovered.expenses.length, 1);
});

test('Expense SQLite: insufficient funds are recorded and negative spendable funds remain visible', async (t) => {
  const { repo } = await fixture(t);
  const saved = await repo.addExpense(add({ expense: { ...add().expense, amountMinor: 800000 } }));
  assert.equal(saved.result.remainingBalanceMinor, 200000);
  assert.equal(saved.result.spendableMinor, -100000);
  assert.equal(saved.result.budgetDeficitMinor, 100000);
  if (saved.result.periodStatus !== 'active') throw new Error('Expected active budget');
  assert.equal(saved.result.daily.recommendedDailyMinor, 0);
  assert.equal(saved.result.daily.todayRemainingMinor, -730000);
});

test('Expense SQLite: zero initial funds still allow a real one-kuruş expense', async (t) => {
  const base = command();
  const { repo } = await fixture(t, command({ input: { ...base.input, balanceSnapshot: { ...base.input.balanceSnapshot, amountMinor: 0 }, savingsTargetMinor: 0, payments: [] }, paymentNames: [] }));
  assert.equal((await repo.addExpense(add({ expense: { ...add().expense, amountMinor: 1 } }))).result.remainingBalanceMinor, -1);
});

test('Expense SQLite: aggregate overflow rejects the write atomically', async (t) => {
  const base = command();
  const { repo } = await fixture(t, command({ input: { ...base.input, balanceSnapshot: { ...base.input.balanceSnapshot, amountMinor: Number.MIN_SAFE_INTEGER }, savingsTargetMinor: 0, payments: [] }, paymentNames: [] }));
  await assert.rejects(repo.addExpense(add({ expense: { ...add().expense, amountMinor: 1 } })), { code: 'AMOUNT_OVERFLOW' });
  assert.equal((await repo.load(now))?.revision, 1);
});

test('Expense SQLite: pre-snapshot and exact-cutoff history are not deducted again, including cancellation', async (t) => {
  const { repo } = await fixture(t);
  await repo.addExpense(add({ expense: { ...add().expense, occurredAt: '2026-10-19T06:00:00Z' } }));
  const after = await repo.addExpense(add({ operationId: 'cutoff-op', expectedRevision: 2, expense: { ...add().expense, id: 'cutoff', occurredAt: '2026-10-20T06:00:00Z' } }));
  assert.equal(after.result.remainingBalanceMinor, 1000000);
  assert.equal(after.result.spentSinceSnapshotMinor, 0);
  assert.equal((await repo.cancelExpense(cancel({ expectedRevision: 3 }))).result.remainingBalanceMinor, 1000000);
});

test('Expense SQLite: actual occurrence and entry time are distinct and late entry does not count as today spending', async (t) => {
  const { repo } = await fixture(t);
  const after = await repo.addExpense(add({ expense: { ...add().expense, occurredAt: '2026-10-24T08:00:00Z' } }));
  assert.notEqual(after.expenses[0].occurredAt, after.expenses[0].createdAt);
  assert.equal(after.result.todayOutflowMinor, 0);
  assert.equal(after.result.spentSinceSnapshotMinor, 10000);
});

test('Expense SQLite: expired periods reject new entries but allow correcting historical mistakes', async (t) => {
  const { repo } = await fixture(t); await repo.addExpense(add());
  const late = '2026-11-05T09:00:00Z';
  for (const asOf of ['2026-11-04T09:00:00Z', late]) {
    await assert.rejects(repo.addExpense(add({ operationId: 'late', expectedRevision: 2, asOf })), { code: 'NEW_PERIOD_REQUIRED' });
  }
  const corrected = await repo.cancelExpense(cancel({ asOf: late, cancelledAt: late }));
  assert.equal(corrected.result.periodStatus, 'payday-passed');
  assert.equal(corrected.result.remainingBalanceMinor, 1000000);
});

test('Expense SQLite: no budget or missing expense never creates a phantom record', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const repo = createBudgetRepository(db);
  await assert.rejects(repo.addExpense(add()), { code: 'NOT_FOUND' });
  await assert.rejects(repo.cancelExpense(cancel()), { code: 'NOT_FOUND' });
  await repo.save(command());
  await assert.rejects(repo.cancelExpense(cancel({ expectedRevision: 1 })), { code: 'NOT_FOUND' });
});

test('Expense SQLite: canonical instants sort by actual time across different offsets', async (t) => {
  const { repo } = await fixture(t);
  await repo.addExpense(add({ expense: { ...add().expense, occurredAt: '2026-10-25T10:30:00+03:00' } }));
  const later = '2026-10-25T10:00:00Z';
  const saved = await repo.addExpense(add({ operationId: 'later-op', expectedRevision: 2, asOf: later, expense: { ...add().expense, id: 'later', occurredAt: '2026-10-25T05:30:00-04:00', createdAt: later } }));
  assert.deepEqual(saved.expenses.map(row=>row.id), ['later','expense-one']);
  assert.equal(saved.expenses[0].occurredAt, '2026-10-25T09:30:00.000Z');
});

for (const entry of [
  { label: 'spring DST', snapshot: '2026-03-06T15:00:00Z', asOf: '2026-03-09T03:30:00Z', payday: '2026-03-10', occurred: ['2026-03-08T06:30:00Z','2026-03-08T07:30:00Z'], today: '2026-03-08' },
  { label: 'autumn DST', snapshot: '2026-10-30T14:00:00Z', asOf: '2026-11-02T04:30:00Z', payday: '2026-11-03', occurred: ['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'], today: '2026-11-01' },
]) test(`Expense SQLite: ${entry.label} uses local calendar days and separate real instants`, async (t) => {
  const { repo } = await fixture(t, command({ input: { ...command().input, timeZone: 'America/New_York', asOf: entry.asOf, balanceSnapshot: { amountMinor: 1000000, capturedAt: entry.snapshot }, nextPayday: entry.payday, savingsTargetMinor: 0, payments: [] }, paymentNames: [] }));
  await repo.addExpense(add({ asOf: entry.asOf, expense: { ...add().expense, occurredAt: entry.occurred[0], createdAt: entry.asOf } }));
  const saved = await repo.addExpense(add({ operationId: 'two-op', expectedRevision: 2, asOf: entry.asOf, expense: { ...add().expense, id: 'two', occurredAt: entry.occurred[1], createdAt: entry.asOf, amountMinor: 20000 } }));
  assert.equal(saved.result.today, entry.today); assert.equal(saved.result.daysUntilPayday, 2);
  if (saved.result.periodStatus !== 'active') throw new Error('Expected active budget');
  assert.equal(saved.result.daily.todayStartTargetMinor, 500000);
  assert.equal(saved.result.daily.todayRemainingMinor, 470000);
});

test('Expense SQLite: expense and metadata save races reject stale revisions without losing data', async (t) => {
  const { repo } = await fixture(t);
  const results = await Promise.allSettled([repo.addExpense(add()), repo.save(command({ operationId: 'edit', expectedRevision: 1, input: { ...command().input, savingsTargetMinor: 1 } }))]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.equal(results[1].reason.code, 'CONFLICT');
  const saved = await repo.load(now);
  assert.equal(saved?.expenses.length, 1); assert.equal(saved?.input.savingsTargetMinor, 100000);
});

test('Expense SQLite: metadata winning the race prevents a stale expense and allows an explicit retry', async (t) => {
  const { repo } = await fixture(t);
  const outcomes = await Promise.allSettled([repo.save(command({ operationId: 'edit', expectedRevision: 1 })), repo.addExpense(add())]);
  assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
  assert.equal((await repo.load(now))?.expenses.length, 0);
  assert.equal((await repo.addExpense(add({ expectedRevision: 2 }))).expenses.length, 1);
});

test('Expense SQLite: retry after a concurrent balance snapshot keeps the actual occurrence cutoff', async (t) => {
  const { repo } = await fixture(t);
  const pendingExpense = add();
  await repo.save(command({ operationId: 'new-opening', expectedRevision: 1, input: {
    ...command().input, asOf: now, balanceSnapshot: { amountMinor: 900000, capturedAt: now },
  } }));
  await assert.rejects(repo.addExpense(pendingExpense), { code: 'CONFLICT' });
  const retried = await repo.addExpense({ ...pendingExpense, expectedRevision: 2 });
  assert.equal(retried.result.remainingBalanceMinor, 900000);
  assert.equal(retried.result.spentSinceSnapshotMinor, 0);
  assert.equal(retried.expenses[0].occurredAt, '2026-10-25T08:00:00.000Z');
});

test('Expense SQLite: opening changes remain locked after cancellation and SQL cannot bypass the lock', async (t) => {
  const { repo, db } = await fixture(t); await repo.addExpense(add()); await repo.cancelExpense(cancel());
  for (const patch of [
    { balanceSnapshot: { ...command().input.balanceSnapshot, amountMinor: 123 } },
    { balanceSnapshot: { ...command().input.balanceSnapshot, capturedAt: now } },
    { timeZone: 'UTC' }, { nextPayday: '2026-11-05' },
  ]) await assert.rejects(repo.save(command({ operationId: 'locked', expectedRevision: 3, input: { ...command().input, ...patch } })), { code: 'BALANCE_LOCKED' });
  assert.throws(()=>db.db.prepare('UPDATE budget_periods SET balance_minor=?').run(123));
  assert.throws(()=>db.db.exec('DELETE FROM budget_expenses'));
  db.db.exec('PRAGMA foreign_keys=OFF');
  assert.throws(()=>db.db.exec('DELETE FROM budget_periods'));
  assert.equal((await repo.load(now))?.revision, 3);
});

test('Expense SQLite: metadata preview and save both retain real transactions', async (t) => {
  const { repo } = await fixture(t); const saved = await repo.addExpense(add());
  const prepared = prepareBudgetSave({ ...savedBudgetToDraft(saved), savings: '500' }, { asOf: now, timeZone: 'UTC' }, saved, 'edit');
  assert.equal(prepared.status, 'ready');
  if (prepared.status !== 'ready') throw new Error('Expected valid metadata edit');
  assert.equal(prepared.result.spendableMinor, 740000);
  assert.deepEqual(prepared.command.input.transactions, []);
  const after = await repo.save(prepared.command);
  assert.equal(after.result.spendableMinor, 740000); assert.equal(after.expenses.length, 1);
  const locked = prepareBudgetSave({ ...savedBudgetToDraft(after), balance: '999' }, { asOf: now, timeZone: 'UTC' }, after, 'locked');
  assert.equal(locked.status, 'invalid');
});

test('Expense SQLite: expense identifiers and descriptions are bound SQL parameters', async (t) => {
  const { repo, db } = await fixture(t);
  const description = "'); DROP TABLE budget_periods; --";
  const saved = await repo.addExpense(add({ expense: { ...add().expense, description } }));
  assert.equal(saved.expenses[0].description, description);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
  assert.throws(()=>db.db.prepare('UPDATE budget_expenses SET amount_minor=?').run(12.5));
  assert.throws(()=>db.db.prepare('UPDATE budget_expenses SET amount_minor=?').run(1));
});

test('Expense SQLite: v2 SQL types, categories, identities and parent links are enforced', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const sql = 'INSERT INTO budget_expenses VALUES (?,?,?,?,?,?,?,?,?)';
  const values = ['raw', 1, 1, 'market', '', '2026-10-25T08:00:00.000Z', '2026-10-25T09:00:00.000Z', 'active', null];
  db.db.exec('PRAGMA foreign_keys=OFF');
  assert.throws(()=>db.db.prepare(sql).run(...values)); // The trigger also protects fresh native connections.
  const repo = createBudgetRepository(db); await repo.save(command());
  assert.throws(()=>db.db.prepare(sql).run('raw',1,0.5,...values.slice(3)));
  assert.throws(()=>db.db.prepare(sql).run('raw',1,1,'bad',...values.slice(4)));
  assert.throws(()=>db.db.prepare(sql).run('raw',1,Number.MAX_SAFE_INTEGER + 1,...values.slice(3)));
  await repo.addExpense(add());
  assert.throws(()=>db.db.prepare(sql).run('expense-one',...values.slice(1)));
});

test('Expense SQLite: invalid category, period, revision and cancellation clock are rejected', async (t) => {
  const { repo } = await fixture(t);
  const input = add(); Reflect.set(input.expense, 'category', 'forged');
  await assert.rejects(repo.addExpense(input), { code: 'INVALID_DATA' });
  await assert.rejects(repo.addExpense(add({ periodId: 2 })), { code: 'INVALID_DATA' });
  await assert.rejects(repo.addExpense(add({ expectedRevision: NaN })), { code: 'INVALID_DATA' });
  await repo.addExpense(add());
  await assert.rejects(repo.cancelExpense(cancel({ cancelledAt: '2026-10-26T09:00:00Z' })), { code: 'INVALID_DATA' });
  await assert.rejects(repo.cancelExpense(cancel({ cancelledAt: '2026-10-25T08:00:00Z' })), { code: 'INVALID_DATA' });
});

test('Expense SQLite: a forged canonical-looking date is rejected without erasing records', async (t) => {
  const { repo, db } = await fixture(t); await repo.addExpense(add());
  db.db.exec("DROP TRIGGER expense_immutable; UPDATE budget_expenses SET occurred_at='2026-02-30T08:00:00.000Z'");
  await assert.rejects(repo.load(now), { code: 'INVALID_DATA' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_expenses').get()?.n, 1);
});

test('Expense SQLite: corrupted cancelled data is validated even though it is excluded from calculation', async (t) => {
  const { repo, db } = await fixture(t); await repo.addExpense(add()); await repo.cancelExpense(cancel());
  db.db.exec("DROP TRIGGER expense_immutable; PRAGMA ignore_check_constraints=ON; UPDATE budget_expenses SET category='forged'");
  await assert.rejects(repo.load(now), { code: 'INVALID_DATA' });
});

test('Expense SQLite: an operation receipt cannot confirm a different persisted expense', async (t) => {
  const { repo, db } = await fixture(t); await repo.addExpense(add());
  db.db.exec('DROP TRIGGER expense_immutable; UPDATE budget_expenses SET amount_minor=1');
  await assert.rejects(repo.addExpense(add()), { code: 'INVALID_DATA' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_expenses').get()?.n, 1);
});

for (const [label, patch] of [
  ['zero', { amountMinor: 0 }], ['negative', { amountMinor: -1 }], ['fractional kuruş', { amountMinor: 0.5 }],
  ['NaN', { amountMinor: NaN }], ['infinity', { amountMinor: Infinity }], ['overflow', { amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
  ['empty id', { id: '' }], ['long description', { description: 'x'.repeat(201) }],
  ['implicit timezone', { occurredAt: '2026-10-25T08:00:00' }], ['invalid date', { occurredAt: '2026-02-30T00:00:00Z' }],
  ['future occurrence', { occurredAt: '2026-10-26T00:00:00Z' }], ['future creation', { createdAt: '2026-10-26T00:00:00Z' }],
  ['creation before occurrence', { createdAt: '2026-10-25T07:00:00Z' }],
] satisfies [string, Partial<ExpenseData>][]) test(`Expense SQLite: invalid ${label} is rejected without changing the budget`, async (t) => {
  const { repo, saved } = await fixture(t);
  await assert.rejects(repo.addExpense(add({ expense: { ...add().expense, ...patch } })), { code: 'INVALID_DATA' });
  assert.deepEqual(await repo.load(saved.input.asOf), saved);
});
