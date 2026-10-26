import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { clock, payday, snapshot } from '../../src/devtools/native-v3/fixtures';
import { readRuntimeEntry } from '../../src/data/budget/runtime-catalog';
import { prepareBudgetSave, savedBudgetToDraft } from '../../src/features/budget-setup/persistence';
import { deferred } from '../period-ui/fixtures';
import { applicationFixture } from './fixture';
import { createApplicationRuntime } from '../../src/data/budget/application-runtime';
import { BudgetStorageError } from '../../src/data/budget/errors';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

test('7D-3 startup: source v2 preserved, catalog switches atomically, reopen never migrates again', async t => {
  const f = await applicationFixture(t); let migrations = 0;
  const options = { autoUpgrade: true, migrate: async (db: Parameters<typeof migrateDatabaseV3>[0]) => { migrations++; await migrateDatabaseV3(db); } };
  const app = f.create(options); await app.initialize(); const a = await app.open(clock);
  assert.equal(a.access.schema, 3); assert.equal(a.saved?.expenses.length, 4); assert.equal(a.saved?.result.spentSinceSnapshotMinor, 101);
  const files = await f.factory(); assert.equal((await files.source.query.all('PRAGMA user_version'))[0]?.user_version, 2);
  assert.equal((await files.catalog.transaction(readRuntimeEntry)).schema, 3);
  await app.close(); const reopened = f.create(options); await reopened.initialize(); assert.equal(migrations, 1);
  assert.equal((await reopened.open(clock)).access.schema, 3);
});
test('7D-3 fence: deferred native-style catalog transactions block a second repository during backup/migration', async t => {
  const f = await applicationFixture(t), entered = deferred<void>(), release = deferred<void>();
  const app = f.create({ migrate: async db => { entered.resolve(); await release.promise; await migrateDatabaseV3(db); } }), other = f.create();
  await app.initialize(); await other.initialize(); const old = await other.open(clock); assert.ok(old.saved);
  const migration = app.upgrade(); await entered.promise;
  await assert.rejects(app.newOperationId(), { code: 'MIGRATION' });
  await assert.rejects(other.newOperationId(), { code: 'MIGRATION' });
  const files = await f.factory(); assert.equal((await files.source.query.all('SELECT revision FROM budget_periods'))[0]?.revision, 5);
  release.resolve(); await migration;
  const command = prepareBudgetSave(savedBudgetToDraft(old.saved!), { asOf: clock, timeZone: 'Europe/Istanbul' }, old.saved, 'a'.repeat(32));
  if (command.status !== 'ready') throw Error('fixture');
  await assert.rejects(other.save({ ...command.command, access: old.access }), { code: 'CONFLICT' });
  await assert.rejects(other.save(command.command), { code: 'CONFLICT' });
});
test('7D-3 application: scoped expense/cancel retries, revisions, periods and archives stay isolated', async t => {
  const f = await applicationFixture(t), app = f.create({ autoUpgrade: true }); await app.initialize();
  const a = await app.open(clock); assert.ok(a.saved);
  const operationId = await app.newOperationId();
  const command = { operationId, access: a.access, periodId: a.access.period!.id, expectedRevision: a.saved!.revision, asOf: clock,
    expense: { id: operationId, amountMinor: 25001, category: 'market' as const, description: '', occurredAt: clock, createdAt: clock } };
  const spent = await app.addExpense(command), retry = await app.addExpense(command);
  assert.equal(spent.revision, retry.revision); assert.equal(retry.result.spentSinceSnapshotMinor, 25102);
  await assert.rejects(app.addExpense({ ...command, operationId: await app.newOperationId(), expense: { ...command.expense, id: 'different' } }), { code: 'CONFLICT' });
  const cancel = { operationId: await app.newOperationId(), access: spent.access, periodId: spent.access.period!.id, expectedRevision: spent.revision,
    expenseId: operationId, expensePublicId: spent.expensePublicIds[operationId], cancelledAt: clock, asOf: clock };
  const cancelled = await app.cancelExpense(cancel); assert.equal(cancelled.result.spentSinceSnapshotMinor, 101);
  assert.equal((await app.cancelExpense(cancel)).revision, cancelled.revision);
  f.setNow(payday); const port = await app.periods(), source = await port.loadActivePeriod(1, payday); assert.ok(source);
  const transition = { operationId: await app.newOperationId(), bookId: 1, sourcePeriodId: source!.id, sourcePeriodPublicId: source!.publicId,
    expectedSourceRevision: source!.revision, expectedActivationRevision: (await port.loadBook(1)).activationRevision,
    newPeriodPublicId: await app.newOperationId(), availableBalanceConfirmed: true as const, availableBalanceMinor: 300025,
    balanceCapturedAt: payday, nextPayday: '2026-12-04', savingsTargetMinor: 50000, asOf: payday,
    carryPayments: [{ sourcePaymentId: 'rent', sourcePaymentPublicId: source!.payments.find(p => p.id === 'rent')!.publicId,
      newId: 'new-rent', newPublicId: await app.newOperationId(), dueOn: '2026-11-28' }] };
  await port.startPeriod(transition); assert.equal((await port.startPeriod(transition)).replayed, true);
  const b = await app.open(payday); assert.equal(b.saved?.result.spendableMinor, 50025); assert.equal(b.saved?.expenses.length, 0);
  await assert.rejects(app.addExpense({ ...command, operationId: await app.newOperationId(), asOf: payday }), { code: 'CONFLICT' });
  const history = await port.listClosedPeriods(1); assert.equal(history.length, 1); assert.equal(history[0].result.today, '2026-11-04');
  assert.ok(history[0].expenses.some(row => row.id === operationId && row.status === 'cancelled'));
});
test('7D-3 recovery: failed candidate leaves durable fence; fresh startup verifies v2 without accepting partial v3', async t => {
  const f = await applicationFixture(t), app = f.create({ autoUpgrade: true, migrate: async () => { throw Error('INJECTED_FAILURE'); } });
  await assert.rejects(app.initialize()); assert.equal(app.getSnapshot().phase, 'blocked');
  const files = await f.factory(); assert.equal((await files.catalog.transaction(readRuntimeEntry)).phase, 'pending');
  const before = await snapshot(files.source.query); await app.close();
  const recovered = f.create({ autoUpgrade: true }); await recovered.initialize(); assert.equal(recovered.getSnapshot().schema, 2);
  assert.equal(await snapshot(files.source.query), before); await recovered.upgrade(); assert.equal(recovered.getSnapshot().schema, 3);
});
test('7D-3 schema fence: changed file schema is rejected before old repository writes', async t => {
  const f = await applicationFixture(t), app = f.create(); await app.initialize();
  const saved = await app.open(clock), files = await f.factory(); await files.source.query.exec('PRAGMA user_version=99');
  const before = await snapshot(files.source.query); await assert.rejects(app.load(clock), { code: 'MIGRATION' }); assert.equal(await snapshot(files.source.query), before);
  assert.equal(saved.access.schema, 2);
});
test('7D-3 production capability: v2-only host cannot enable transition even through direct API', async t => {
  const f = await applicationFixture(t), app = f.create({ allowV3: false }); await app.initialize();
  await assert.rejects(app.upgrade(), { code: 'UNSUPPORTED' }); assert.equal((await app.open(clock)).access.schema, 2);
});
test('7D-3 web preview: repeated unsupported opens remain UNSUPPORTED instead of masquerading as migration failure', async () => {
  const app = createApplicationRuntime({ allowV3: false, now: () => clock, store: async () => { throw new BudgetStorageError('UNSUPPORTED','Web'); } });
  await assert.rejects(app.open(clock), { code: 'UNSUPPORTED' }); await assert.rejects(app.open(clock), { code: 'UNSUPPORTED' });
});
test('7D-3 downgrade fence: a v2-only binary refuses an activated v3 catalog without resetting source or catalog', async t => {
  const f = await applicationFixture(t), upgraded = f.create({ autoUpgrade: true }); await upgraded.initialize(); await upgraded.close();
  const files = await f.factory(), before = await snapshot(files.source.query), pointer = await files.catalog.transaction(readRuntimeEntry);
  const old = f.create({ allowV3: false }); await assert.rejects(old.initialize(), { code: 'MIGRATION' });
  assert.equal(await snapshot(files.source.query), before); assert.deepEqual(await files.catalog.transaction(readRuntimeEntry), pointer);
});
test('7D-3 initial setup: empty migrated book saves once with the captured initial access', async t => {
  const f = await applicationFixture(t, true), app = f.create({ autoUpgrade: true }); await app.initialize();
  const session = await app.open(clock); assert.equal(session.saved, null); assert.equal(session.access.schema, 3);
  const prepared = prepareBudgetSave({ balance: '3.000,25', payday: '04.11.2026', savings: '500,00', payments: [] },
    { asOf: clock, timeZone: 'Europe/Istanbul' }, null, await app.newOperationId());
  assert.equal(prepared.status, 'ready'); if (prepared.status !== 'ready') throw Error('fixture');
  const command = { ...prepared.command, access: session.access }, saved = await app.save(command);
  assert.equal(saved.result.spendableMinor, 250025); assert.equal((await app.save(command)).revision, saved.revision);
  await assert.rejects(app.save({ ...command, operationId: await app.newOperationId() }), { code: 'CONFLICT' });
});
test('7D-3 settings: existing v3 context preserves opening, expenses and exact TRY values on retry', async t => {
  const f = await applicationFixture(t), app = f.create({ autoUpgrade: true }); await app.initialize();
  const session = await app.open(clock); assert.ok(session.saved);
  const draft = { ...savedBudgetToDraft(session.saved), savings: '1.000,01' };
  const prepared = prepareBudgetSave(draft, { asOf: clock, timeZone: 'Europe/Istanbul' }, session.saved, await app.newOperationId());
  assert.equal(prepared.status, 'ready'); if (prepared.status !== 'ready') throw Error('fixture');
  const command = { ...prepared.command, access: session.access }, saved = await app.save(command);
  assert.equal(saved.input.savingsTargetMinor, 100001); assert.equal(saved.input.balanceSnapshot.capturedAt, session.saved.input.balanceSnapshot.capturedAt);
  assert.equal(saved.result.spentSinceSnapshotMinor, 101); assert.equal(saved.expenses.length, 4); assert.equal((await app.save(command)).revision, saved.revision);
});
test('7D-3 catalog corruption: a pointer changed back to v2 cannot hide an activated transition', async t => {
  const f = await applicationFixture(t), app = f.create({ autoUpgrade: true }); await app.initialize(); await app.close();
  const files = await f.factory(); await files.catalog.transaction(tx => tx.run("UPDATE runtime_state SET epoch=1,schema_version=2,active_key='source' WHERE id=1", []));
  const before = await snapshot(files.source.query), reopened = f.create(); await assert.rejects(reopened.initialize(), { code: 'MIGRATION' });
  assert.equal(await snapshot(files.source.query), before);
});
test('7D-3 catalog corruption: pending state without a matching durable intent is not silently recovered', async t => {
  const f = await applicationFixture(t), app = f.create(); await app.initialize(); await app.close();
  const files = await f.factory(); await files.catalog.transaction(tx => tx.run("UPDATE runtime_state SET phase='pending',operation_id=?,prefix=? WHERE id=1", ['a'.repeat(32),'up-'+ 'a'.repeat(16)]));
  const before = await snapshot(files.source.query), reopened = f.create(); await assert.rejects(reopened.initialize(), { code: 'MIGRATION' });
  assert.equal(await snapshot(files.source.query), before);
});
test('7D-3 missing source: an existing catalog cannot silently bootstrap a replacement empty budget', async t => {
  const f = await applicationFixture(t), app = f.create(); await app.initialize(); await app.close();
  // Only this test's own temporary fixture is removed to simulate a missing file.
  rmSync(join(f.directory,'source.db'));
  const reopened = f.create(); await assert.rejects(reopened.initialize(), { code: 'MIGRATION' });
  const files = await f.factory(); assert.equal((await files.source.query.all('PRAGMA user_version'))[0]?.user_version, 0);
  assert.equal((await files.source.query.all("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).length, 0);
});
