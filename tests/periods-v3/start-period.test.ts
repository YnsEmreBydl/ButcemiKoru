import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBudgetRepositoryV3 } from '../../src/data/budget/repository-v3';
import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { snapshot } from '../migrations-v3/fixtures';
import { add, fixture, nextPayday, payday, pid, scope, start } from './fixtures';

test('v3 repository: start closes A and creates B with only the explicit balance and selected invoice', async t => {
  const { db, repo, active } = await fixture(t); const command = start(active);
  const oldReceipts = db.db.prepare('SELECT operation_id,period_id,payload,resulting_revision,public_id FROM budget_save_operations ORDER BY operation_id').all();
  const result = await repo.startPeriod(command);
  assert.equal(result.replayed, false); assert.equal(result.source.status, 'closed'); assert.equal(result.source.revision, 6);
  assert.equal(result.source.closedAt, payday); assert.equal(result.source.calculationVersion, 'budget-engine-v1');
  assert.equal(result.target.status, 'active'); assert.equal(result.target.previousPeriodId, active.id);
  assert.equal(result.target.input.balanceSnapshot.amountMinor, 300000); assert.equal(result.target.input.transactions.length, 0);
  assert.equal(result.target.expenses.length, 0); assert.equal(result.target.result.spentSinceSnapshotMinor, 0);
  assert.equal(result.target.result.remainingBalanceMinor, 300000); assert.equal(result.target.result.reservedPaymentsMinor, 200000);
  assert.equal(result.target.result.spendableMinor, 50000); assert.equal(result.target.result.daysUntilPayday, 30);
  assert.equal(result.target.result.daily?.recommendedDailyMinor, 1666);
  assert.equal(result.source.result.spentSinceSnapshotMinor, 101); // Historical/exact cutoff/cancelled stay excluded.
  assert.equal(result.target.payments[0].id, 'b-rent'); assert.equal(result.target.payments[0].publicId, pid(200));
  assert.deepEqual(result.target.payments[0].carriedFrom, { periodId: active.id, paymentId: 'rent' });
  assert.equal(active.payments.length, 2); assert.equal(result.source.payments.length, 2); assert.equal(result.target.payments.length, 1);
  assert.equal((await repo.loadBook(1)).activationRevision, 2); assert.equal(result.transitionActivationRevision, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_periods WHERE book_id=1 AND status='active'").get()?.n, 1);
  for (const row of oldReceipts) assert.deepEqual(db.db.prepare('SELECT operation_id,period_id,payload,resulting_revision,public_id FROM budget_save_operations WHERE operation_id=?').get(row.operation_id), row);
});

test('v3 repository: three periods, frozen A/B archive and old A->B replay never touch C', async t => {
  const { db, repo, active } = await fixture(t); const ab = start(active); const b = (await repo.startPeriod(ab)).target;
  if (b.status !== 'active') throw Error('fixture');
  const aArchive = await repo.loadClosedPeriod(scope(active));
  const spent = await repo.addExpense(add(b)); if (spent.status !== 'active') throw Error('fixture');
  const c = await repo.startPeriod(start(spent, { operationId: 'b-to-c', expectedActivationRevision: 2,
    newPeriodPublicId: pid(3), balanceCapturedAt: nextPayday, asOf: nextPayday, nextPayday: '2027-01-04',
    availableBalanceMinor: 450000, savingsTargetMinor: 0, carryPayments: [] }));
  assert.equal(c.target.id, 3); assert.equal(c.target.result.remainingBalanceMinor, 450000);
  assert.equal(c.target.result.spentSinceSnapshotMinor, 0); assert.equal(c.target.payments.length, 0);
  const before = snapshot(db); const replay = await repo.startPeriod(ab);
  assert.equal(replay.replayed, true); assert.equal(replay.target.id, b.id); assert.equal(replay.target.status, 'closed');
  assert.equal(replay.transitionActivationRevision, 2); assert.deepEqual(snapshot(db), before);
  assert.deepEqual(await repo.loadClosedPeriod(scope(active)), aArchive);
  assert.equal((await repo.loadActivePeriod(1, '2027-01-01T09:00:00.000Z'))?.id, c.target.id);
  assert.deepEqual(await repo.loadClosedPeriod(scope(b)), c.source);
});

test('v3 repository: duplicate taps and reordered selections replay one immutable receipt', async t => {
  const { db, repo, active } = await fixture(t);
  const bill = active.payments.find(p => p.id !== 'rent'); if (!bill) throw Error('fixture');
  const command = start(active, { carryPayments: [...start(active).carryPayments, {
    sourcePaymentId: bill.id, sourcePaymentPublicId: bill.publicId, newId: 'b-electric', newPublicId: pid(201), dueOn: '2026-11-29',
  }] });
  const [first, second] = await Promise.all([repo.startPeriod(command), repo.startPeriod({ ...command, carryPayments: [...command.carryPayments].reverse() })]);
  assert.equal(first.target.id, second.target.id); assert.equal(second.replayed, true);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_save_operations WHERE kind='period-open'").get()?.n, 1);
});

test('v3 repository: same operation ID with changed content conflicts without changing rows', async t => {
  const { db, repo, active } = await fixture(t); const command = start(active); await repo.startPeriod(command); const before = snapshot(db);
  for (const patch of [{ availableBalanceMinor: 300001 }, { nextPayday: '2026-12-05' }, { carryPayments: [] }, { newPeriodPublicId: pid(999) }, { expectedSourceRevision: 6 }]) {
    await assert.rejects(repo.startPeriod({ ...command, ...patch }), { code: 'CONFLICT' });
    assert.deepEqual(snapshot(db), before);
  }
});

test('v3 repository: old original clock can replay an active target after later expenses without rewriting it', async t => {
  const { db, repo, active } = await fixture(t); const command = start(active); const created = await repo.startPeriod(command);
  if (created.target.status !== 'active') throw Error('fixture');
  await repo.addExpense(add(created.target)); const before = snapshot(db);
  const retried = await repo.startPeriod(command);
  assert.equal(retried.target.expenses.length, 1); assert.equal(retried.target.result.remainingBalanceMinor, 290000);
  assert.deepEqual(snapshot(db), before);
});

for (const [label, patch, code] of [
  ['source revision', { expectedSourceRevision: 4 }, 'CONFLICT'],
  ['activation revision', { expectedActivationRevision: 0 }, 'CONFLICT'],
  ['missing source', { sourcePeriodId: 987 }, 'NOT_FOUND'],
  ['wrong source public ID', { sourcePeriodPublicId: pid(987) }, 'CONFLICT'],
  ['zero source', { sourcePeriodId: 0 }, 'INVALID_DATA'],
  ['fractional source', { sourcePeriodId: 1.5 }, 'INVALID_DATA'],
  ['unconfirmed balance', { availableBalanceConfirmed: false }, 'INVALID_DATA'],
  ['missing selection list', { carryPayments: null }, 'INVALID_DATA'],
  ['fractional money', { availableBalanceMinor: 0.5 }, 'INVALID_DATA'],
  ['unsafe money', { availableBalanceMinor: 9007199254740992 }, 'INVALID_DATA'],
  ['NaN money', { availableBalanceMinor: NaN }, 'INVALID_DATA'],
  ['infinite money', { availableBalanceMinor: Infinity }, 'INVALID_DATA'],
  ['negative savings', { savingsTargetMinor: -1 }, 'INVALID_DATA'],
  ['invalid calendar date', { nextPayday: '2026-02-30' }, 'INVALID_DATA'],
  ['implicit offset', { balanceCapturedAt: '2026-11-04T09:00:00' }, 'INVALID_DATA'],
  ['future snapshot', { balanceCapturedAt: '2026-11-05T09:00:00Z' }, 'INVALID_DATA'],
  ['premature transition', { balanceCapturedAt: '2026-11-03T09:00:00Z', asOf: '2026-11-03T09:00:00Z' }, 'CONFLICT'],
  ['expired new payday', { nextPayday: '2026-11-04', carryPayments: [] }, 'CONFLICT'],
] as const) test(`v3 repository: invalid start ${label} preserves full database`, async t => {
  const { db, repo, active } = await fixture(t); const command = start(active);
  // Reflect only bypasses compile-time input types so runtime validation can be tested.
  for (const [key, value] of Object.entries(patch)) Reflect.set(command, key, value);
  const before = snapshot(db); await assert.rejects(repo.startPeriod(command), { code }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: missing, duplicate, reused and mismatching carry invoice identities are rejected', async t => {
  const { db, repo, active } = await fixture(t); const command = start(active); const item = command.carryPayments[0];
  const before = snapshot(db);
  for (const [carryPayments, code] of [
    [[{ ...item, sourcePaymentId: 'missing' }], 'CONFLICT'],
    [[{ ...item, sourcePaymentPublicId: pid(900) }], 'CONFLICT'],
    [[item, { ...item, newId: 'another', newPublicId: pid(901) }], 'INVALID_DATA'],
    [[{ ...item, newId: item.sourcePaymentId }], 'INVALID_DATA'],
    [[{ ...item, newPublicId: item.sourcePaymentPublicId }], 'INVALID_DATA'],
    [[{ ...item, dueOn: '2026-12-04' }], 'INVALID_DATA'],
  ] as const) {
    await assert.rejects(repo.startPeriod({ ...command, carryPayments }), { code }); assert.deepEqual(snapshot(db), before);
  }
});

test('v3 repository: no selected invoices means no automatic transfer of reserves or history', async t => {
  const { repo, active } = await fixture(t);
  const result = await repo.startPeriod(start(active, { carryPayments: [], availableBalanceMinor: 0, savingsTargetMinor: 0 }));
  assert.equal(result.target.payments.length, 0); assert.equal(result.target.expenses.length, 0);
  assert.equal(result.target.result.spendableMinor, 0); assert.equal(result.source.expenses.length, 4);
});

test('v3 repository: exact large and negative balances are accepted, aggregate overflow rolls back', async t => {
  const { db, repo, active } = await fixture(t); const before = snapshot(db);
  await assert.rejects(repo.startPeriod(start(active, { availableBalanceMinor: -Number.MAX_SAFE_INTEGER, savingsTargetMinor: 0 })), { code: 'AMOUNT_OVERFLOW' });
  assert.deepEqual(snapshot(db), before);
  const result = await repo.startPeriod(start(active, { availableBalanceMinor: Number.MAX_SAFE_INTEGER, savingsTargetMinor: 0, carryPayments: [] }));
  assert.equal(result.target.result.remainingBalanceMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(db.db.prepare('SELECT typeof(balance_minor) AS type FROM budget_periods WHERE id=?').get(result.target.id)?.type, 'integer');
});

test('v3 repository: negative spendable money is visible and not treated as a failed transition', async t => {
  const { repo, active } = await fixture(t);
  const result = await repo.startPeriod(start(active, { availableBalanceMinor: -100, savingsTargetMinor: 0 }));
  assert.equal(result.target.result.remainingBalanceMinor, -100); assert.equal(result.target.result.spendableMinor, -200100);
  assert.equal(result.target.result.budgetDeficitMinor, 200100);
});

test('v3 repository: reopen preserves closed snapshot, stable public IDs and replay receipts', async t => {
  const { db, files, repo, active } = await fixture(t); const command = start(active); const result = await repo.startPeriod(command);
  db.close(); const reopened = createBudgetRepositoryV3(files.open());
  assert.deepEqual(await reopened.loadClosedPeriod(scope(active)), result.source);
  assert.deepEqual(await reopened.loadActivePeriod(1, payday), result.target);
  assert.equal((await reopened.startPeriod(command)).replayed, true);
});

test('v3 repository: captured request cannot be changed by its caller while queued', async t => {
  const { db, active } = await fixture(t); let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const repo = createBudgetRepositoryV3({ transaction: async task => { await gate; return db.transaction(task); } });
  const command = start(active); const pending = repo.startPeriod(command);
  Reflect.set(command, 'availableBalanceMinor', 1); Reflect.set(command.carryPayments[0], 'dueOn', '2030-01-01');
  release?.(); const saved = await pending; assert.equal(saved.target.result.remainingBalanceMinor, 300000);
  assert.equal(saved.target.payments[0].dueOn, '2026-11-28');
});

test('v3 repository: equivalent explicit offset encodings replay a single transition', async t => {
  const { repo, active } = await fixture(t); const command = start(active); await repo.startPeriod(command);
  const alternate: StartPeriodCommandV3 = { ...command, balanceCapturedAt: '2026-11-04T12:00:00+03:00', asOf: '2026-11-04T12:00:00+03:00' };
  assert.equal((await repo.startPeriod(alternate)).replayed, true);
});
