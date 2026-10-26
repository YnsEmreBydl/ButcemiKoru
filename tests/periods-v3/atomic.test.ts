import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtomicDatabase } from '../../src/data/budget/contracts';
import { createBudgetRepositoryV3 } from '../../src/data/budget/repository-v3';
import { snapshot } from '../migrations-v3/fixtures';
import { add, edit, fixture, inject, payday, pid, start } from './fixtures';

for (const marker of ["UPDATE budget_periods SET status='closed'", 'INSERT INTO budget_periods',
  'INSERT INTO budget_payments', 'UPDATE budget_books', 'INSERT INTO budget_save_operations']) {
  test(`v3 repository real rollback: failure after ${marker}`, async t => {
    const { db, files, active } = await fixture(t); const before = snapshot(db);
    const broken = createBudgetRepositoryV3(inject(db, async sql => { if (sql.includes(marker)) throw Error('Injected write failure'); }));
    await assert.rejects(broken.startPeriod(start(active)), /Injected write failure/);
    assert.deepEqual(snapshot(db), before); db.close(); const reopened = files.open(); assert.deepEqual(snapshot(reopened), before);
    assert.equal((await createBudgetRepositoryV3(reopened).startPeriod(start(active))).target.id, 2);
  });
}

test('v3 repository real rollback: final integrity failure restores source, child rows, receipt and book revision', async t => {
  const { db, active } = await fixture(t); const before = snapshot(db);
  const broken = createBudgetRepositoryV3(inject(db, async (sql, tx) => {
    if (sql.includes('INSERT INTO budget_save_operations')) await tx.exec('DROP TRIGGER operation_immutable');
  }));
  await assert.rejects(broken.startPeriod(start(active)), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
});

test('v3 repository real rollback: pre-commit failure is propagated rather than returning success', async t => {
  const { db, active } = await fixture(t); const before = snapshot(db);
  const broken: AtomicDatabase = { transaction: task => db.transaction(async tx => { await task(tx); throw Error('Injected pre-commit failure'); }) };
  await assert.rejects(createBudgetRepositoryV3(broken).startPeriod(start(active)), /Injected pre-commit failure/);
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository real transaction: result remains pending and other connection sees A until commit', async t => {
  const { db, files, active } = await fixture(t); const other = files.open();
  let release: (() => void) | undefined, reached: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; }); const atCommit = new Promise<void>(resolve => { reached = resolve; });
  const delayed: AtomicDatabase = { transaction: task => db.transaction(async tx => { const result = await task(tx); reached?.(); await gate; return result; }) };
  let resolved = false;
  const pending = createBudgetRepositoryV3(delayed).startPeriod(start(active)).then(result => { resolved = true; return result; });
  await atCommit; assert.equal(resolved, false);
  assert.equal(other.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
  assert.equal(other.db.prepare("SELECT id FROM budget_periods WHERE status='active'").get()?.id, active.id);
  release?.(); await pending;
  assert.equal(other.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
});

test('v3 repository: lost post-commit acknowledgement is recovered from durable receipt', async t => {
  const { db, repo, active } = await fixture(t); const command = start(active);
  const lost: AtomicDatabase = { transaction: async task => { await db.transaction(task); throw Error('Lost acknowledgement'); } };
  await assert.rejects(createBudgetRepositoryV3(lost).startPeriod(command), /Lost acknowledgement/);
  const before = snapshot(db), recovered = await repo.startPeriod(command);
  assert.equal(recovered.replayed, true); assert.equal(recovered.target.id, 2); assert.deepEqual(snapshot(db), before);
});

test('v3 repository: distinct queued start commands have exactly one winner and queue survives conflict', async t => {
  const { db, repo, active } = await fixture(t);
  const outcomes = await Promise.allSettled([repo.startPeriod(start(active)), repo.startPeriod(start(active, { operationId: 'other', newPeriodPublicId: pid(9) }))]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(row => row.status === 'rejected'); assert.equal(rejected?.reason.code, 'CONFLICT');
  assert.equal((await repo.loadActivePeriod(1, payday))?.id, 2);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
});

test('v3 repository: separate SQLite connections contend, busy maps to CONFLICT and later retry observes winner', async t => {
  const { db, repo, files, active } = await fixture(t); const second = files.open(); second.db.exec('PRAGMA busy_timeout=1');
  const competitor = createBudgetRepositoryV3(second);
  const outcomes = await Promise.allSettled([repo.startPeriod(start(active)), competitor.startPeriod(start(active, { operationId: 'other', newPeriodPublicId: pid(9) }))]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(row => row.status === 'rejected'); assert.equal(rejected?.reason.code, 'CONFLICT');
  await assert.rejects(competitor.startPeriod(start(active, { operationId: 'other', newPeriodPublicId: pid(9) })), { code: 'CONFLICT' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
});

test('v3 repository: expense and edit rollback do not leave revisions, partial invoices or receipts behind', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture'); const before = snapshot(db);
  const broken = createBudgetRepositoryV3(inject(db, async sql => { if (sql.includes('INSERT INTO budget_save_operations')) throw Error('Injected receipt failure'); }));
  await assert.rejects(broken.addExpense(add(b)), /Injected receipt failure/); assert.deepEqual(snapshot(db), before);
  await assert.rejects(broken.saveBudget(edit(b, { input: { ...b.input, savingsTargetMinor: 1 } })), /Injected receipt failure/);
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: expense/edit and expense/start commands cannot both use the same period revision', async t => {
  const { db, repo, active } = await fixture(t); const b = (await repo.startPeriod(start(active))).target;
  if (b.status !== 'active') throw Error('fixture');
  const staleEdit = edit(b, { input: { ...b.input, asOf: add(b).asOf } });
  const outcomes = await Promise.allSettled([repo.addExpense(add(b)), repo.saveBudget(staleEdit)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const before = snapshot(db);
  await assert.rejects(repo.startPeriod(start(b, { operationId: 'b-to-c', expectedActivationRevision: 2, newPeriodPublicId: pid(3),
    balanceCapturedAt: '2026-12-04T09:00:00.000Z', asOf: '2026-12-04T09:00:00.000Z', nextPayday: '2027-01-04', carryPayments: [] })), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(db), before);
});

test('v3 repository: revision overflow and public ID collision are explicit conflicts with no writes', async t => {
  const { db, repo, active } = await fixture(t); const before = snapshot(db);
  await assert.rejects(repo.startPeriod(start(active, { newPeriodPublicId: active.publicId })), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(db), before);
  db.db.exec('UPDATE budget_books SET activation_revision=9007199254740991 WHERE id=1'); const max = snapshot(db);
  await assert.rejects(repo.startPeriod(start(active, { expectedActivationRevision: Number.MAX_SAFE_INTEGER })), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(db), max);
});

test('v3 repository: FK-disabled exclusive-style connections still preserve complete transitions', async t => {
  const { db, repo, active } = await fixture(t, 0); const result = await repo.startPeriod(start(active));
  assert.equal(result.target.payments[0].carriedFrom?.periodId, active.id);
  assert.equal(db.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 0);
  assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(), []);
});
