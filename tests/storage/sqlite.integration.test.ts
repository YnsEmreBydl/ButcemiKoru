import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';

import { migrateDatabase, SCHEMA_VERSION } from '../../src/data/budget/migrations';
import { createBudgetRepository } from '../../src/data/budget/repository';
import type { AtomicDatabase } from '../../src/data/budget/contracts';

import { command, databaseFixture } from './sqlite-helper';

test('SQLite integration: migration v1 is atomic, versioned and idempotent', async (t) => {
  const db = databaseFixture(t).open();
  await migrateDatabase(db);
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
  await createBudgetRepository(db).save(command());
  await migrateDatabase(db);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
});

test('SQLite integration: a failed migration rolls back DDL and keeps version zero', async (t) => {
  const db = databaseFixture(t).open();
  db.db.exec('CREATE TABLE budget_payments (legacy TEXT)');
  await assert.rejects(migrateDatabase(db));
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 0);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='budget_periods'").get()?.n, 0);
  assert(db.db.prepare("SELECT name FROM sqlite_master WHERE name='budget_payments'").get());
});

test('SQLite integration: unknown future schema is rejected without downgrade', async (t) => {
  const db = databaseFixture(t).open();
  db.db.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
  await assert.rejects(migrateDatabase(db), { code: 'MIGRATION' });
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION + 1);
});

test('SQLite integration: save, close and reopen retain exact budget and names', async (t) => {
  const fixture = databaseFixture(t);
  const first = fixture.open();
  await migrateDatabase(first);
  const saved = await createBudgetRepository(first).save(command());
  first.close();
  const second = fixture.open();
  await migrateDatabase(second);
  const reopened = await createBudgetRepository(second).load(command().input.asOf);
  assert.deepEqual(reopened, saved);
  assert.equal(second.db.prepare('SELECT typeof(balance_minor) AS t FROM budget_periods').get()?.t, 'integer');
});

test('SQLite integration: reopen recomputes with the actual clock but preserves opening instant', async (t) => {
  const fixture = databaseFixture(t), db = fixture.open();
  await migrateDatabase(db);
  await createBudgetRepository(db).save(command());
  db.close();
  const repo = createBudgetRepository(fixture.open());
  const nextDay = await repo.load('2026-10-26T12:00:00+03:00');
  assert.equal(nextDay?.result.daysUntilPayday, 9);
  assert.equal(nextDay?.input.balanceSnapshot.capturedAt, command().input.balanceSnapshot.capturedAt);
  assert.deepEqual(nextDay?.input.transactions, []);
  const payday = await repo.load('2026-11-04T12:00:00+03:00');
  assert.equal(payday?.result.periodStatus, 'payday-today');
  assert.equal(payday?.result.daily, null);
});

test('SQLite integration: updates replace invoices atomically and increment revision', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db); await repo.save(command());
  const update = command({ operationId: 'edit', expectedRevision: 1, input: { ...command().input, savingsTargetMinor: 50000, payments: [{ id: 'electric', amountMinor: 12345, dueOn: '2026-10-30' }] }, paymentNames: [{ id: 'electric', name: 'Elektrik' }] });
  const result = await repo.save(update);
  assert.equal(result.revision, 2);
  assert.equal(result.input.savingsTargetMinor, 50000);
  assert.deepEqual(result.paymentNames, update.paymentNames);
  assert.deepEqual(result.input.payments, update.input.payments);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
});

test('SQLite integration: identical retry is durable and does not insert duplicates', async (t) => {
  const fixture = databaseFixture(t), db = fixture.open(); await migrateDatabase(db);
  await createBudgetRepository(db).save(command()); db.close();
  const reopened = fixture.open();
  const retried = await createBudgetRepository(reopened).save(command());
  assert.equal(retried.revision, 1);
  assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM budget_save_operations').get()?.n, 1);
  assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM budget_payments').get()?.n, 1);
});

test('SQLite integration: operation identifiers are generated without creating budget rows', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db);
  const first = await repo.newOperationId(), second = await repo.newOperationId();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.match(second, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.equal(await repo.load(command().input.asOf), null);
  assert.equal((await repo.save(command({ operationId: first }))).revision, 1);
});

test('SQLite integration: acknowledgement retry after payday does not create or rewrite an expired period', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const repo = createBudgetRepository(db);
  await repo.save(command());
  const recovered = await repo.save(command({ input: { ...command().input, asOf: '2026-11-04T12:00:00+03:00' } }));
  assert.equal(recovered.revision, 1);
  assert.equal(recovered.result.periodStatus, 'payday-today');
});

test('SQLite integration: queued save captures its own request before caller mutation', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const repo = createBudgetRepository(db);
  const input = command();
  const pending = repo.save(input);
  Reflect.set(input.input.balanceSnapshot, 'amountMinor', 1);
  Reflect.set(input.paymentNames[0], 'name', 'changed later');
  const saved = await pending;
  assert.equal(saved.input.balanceSnapshot.amountMinor, 1000000);
  assert.equal(saved.paymentNames[0].name, 'Kira');
});

test('SQLite integration: duplicate initial operation and concurrent taps create only one budget', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db);
  const [a, b] = await Promise.all([repo.save(command()), repo.save(command())]);
  assert.equal(a.revision, b.revision);
  await assert.rejects(repo.save(command({ operationId: 'another-create' })), { code: 'ALREADY_EXISTS' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
});

test('SQLite integration: operation key cannot be reused for different content', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db); await repo.save(command());
  await assert.rejects(repo.save(command({ input: { ...command().input, savingsTargetMinor: 1 } })), { code: 'CONFLICT' });
  assert.equal((await repo.load(command().input.asOf))?.input.savingsTargetMinor, 100000);
});

test('SQLite integration: optimistic revision rejects stale edits and old operation replay', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db); await repo.save(command());
  await repo.save(command({ operationId: 'edit-one', expectedRevision: 1 }));
  await assert.rejects(repo.save(command({ operationId: 'stale', expectedRevision: 1 })), { code: 'CONFLICT' });
  await assert.rejects(repo.save(command()), { code: 'CONFLICT' });
  assert.equal((await repo.load(command().input.asOf))?.revision, 2);
});

test('SQLite integration: initial budget and invoice inserts roll back together on SQL failure', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  db.db.exec("CREATE TRIGGER test_fail BEFORE INSERT ON budget_payments WHEN NEW.name='fail' BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
  const repo = createBudgetRepository(db);
  const twoBills = command({ input: { ...command().input, payments: [...command().input.payments, { id: 'second', amountMinor: 100, dueOn: '2026-10-30' }] }, paymentNames: [{ id: 'rent', name: 'Kira' }, { id: 'second', name: 'fail' }] });
  await assert.rejects(repo.save(twoBills));
  assert.equal(await repo.load(command().input.asOf), null);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_save_operations').get()?.n, 0);
  db.db.exec('DROP TRIGGER test_fail');
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_payments').get()?.n, 0);
  assert.equal((await repo.save(twoBills)).revision, 1);
});

test('SQLite integration: failed update restores the old budget, revision and all invoices', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db); const before = await repo.save(command());
  db.db.exec("CREATE TRIGGER test_fail BEFORE INSERT ON budget_payments WHEN NEW.name='fail' BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
  await assert.rejects(repo.save(command({ operationId: 'failed-update', expectedRevision: 1, paymentNames: [{ id: 'rent', name: 'fail' }] })));
  assert.deepEqual(await repo.load(command().input.asOf), before);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_save_operations').get()?.n, 1);
});

test('SQLite integration: commit succeeded but acknowledgement failed; same operation recovers safely', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  let loseAcknowledgement = true;
  const unreliable: AtomicDatabase = { async transaction(task) {
    const result = await db.transaction(task);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('injected lost acknowledgement'); }
    return result;
  } };
  await assert.rejects(createBudgetRepository(unreliable).save(command()));
  const recovered = await createBudgetRepository(db).save(command());
  assert.equal(recovered.revision, 1);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
});

test('SQLite integration: parameterized invoice text cannot execute SQL', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const name = "Elektrik'); DROP TABLE budget_periods; --";
  const result = await createBudgetRepository(db).save(command({ paymentNames: [{ id: 'rent', name }] }));
  assert.equal(result.paymentNames[0].name, name);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
});

test('SQLite integration: STRICT and CHECK constraints reject REAL money, duplicates and unsafe amounts', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); await createBudgetRepository(db).save(command());
  assert.throws(() => db.db.prepare('UPDATE budget_periods SET balance_minor=?').run(12.5));
  assert.throws(() => db.db.prepare('UPDATE budget_periods SET balance_minor=?').run(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => db.db.prepare('UPDATE budget_periods SET currency=?').run('USD'));
  assert.throws(() => db.db.prepare('INSERT INTO budget_payments VALUES (?,?,?,?,?)').run(1, 'rent', 'duplicate', 1, '2026-10-28'));
});

test('SQLite integration: relations also hold when a transaction connection has FK disabled', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  db.db.exec('PRAGMA foreign_keys=OFF');
  assert.throws(() => db.db.prepare('INSERT INTO budget_payments VALUES (?,?,?,?,?)').run(1, 'orphan', 'Fatura', 1, '2026-10-28'));
  await createBudgetRepository(db).save(command());
  db.db.exec('DELETE FROM budget_periods');
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_payments').get()?.n, 0);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_save_operations').get()?.n, 0);
});

test('SQLite integration: stored invalid calendar data is rejected, not trusted or erased', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const repo = createBudgetRepository(db); await repo.save(command());
  db.db.exec("UPDATE budget_periods SET next_payday='2026-02-30'");
  await assert.rejects(repo.load(command().input.asOf), { code: 'INVALID_DATA' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 1);
  await assert.rejects(repo.save(command({ operationId: 'overwrite', expectedRevision: 1 })), { code: 'INVALID_DATA' });
});

test('SQLite integration: corrupt currency is rejected even after bypassing SQL checks', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); await createBudgetRepository(db).save(command());
  db.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE budget_periods SET currency='USD'");
  await assert.rejects(createBudgetRepository(db).load(command().input.asOf), { code: 'INVALID_DATA' });
});

test('SQLite integration: a non-SQLite file is rejected without replacement', (t) => {
  const fixture = databaseFixture(t);
  writeFileSync(fixture.file, 'this is not a SQLite database');
  assert.throws(() => fixture.open());
});

test('SQLite integration: orphan rows never masquerade as a fresh empty installation', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const repo = createBudgetRepository(db);
  await repo.save(command());
  db.db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER period_delete_children; DELETE FROM budget_periods');
  await assert.rejects(repo.load(command().input.asOf), { code: 'INVALID_DATA' });
  await assert.rejects(migrateDatabase(db), { code: 'INVALID_DATA' });
});

test('SQLite integration: version one with missing schema is not silently recreated', async (t) => {
  const db = databaseFixture(t).open(); db.db.exec('PRAGMA user_version=1');
  await assert.rejects(migrateDatabase(db));
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 1);
});

test('SQLite integration: no fake transactions or new expired periods can be saved', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db); const repo = createBudgetRepository(db);
  await assert.rejects(repo.save(command({ input: { ...command().input, transactions: [{ id: 'fake', kind: 'expense', amountMinor: 1, occurredAt: command().input.asOf }] } })), { code: 'INVALID_DATA' });
  await assert.rejects(repo.save(command({ input: { ...command().input, nextPayday: '2026-10-25', payments: [] }, paymentNames: [] })), { code: 'NEW_PERIOD_REQUIRED' });
  assert.equal(await repo.load(command().input.asOf), null);
});

test('SQLite integration: negative available money survives disk roundtrip', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const saved = await createBudgetRepository(db).save(command({ input: { ...command().input, balanceSnapshot: { ...command().input.balanceSnapshot, amountMinor: -100 } } }));
  assert.equal(saved.result.remainingBalanceMinor, -100);
  assert.equal(saved.result.spendableMinor, -300100);
  assert.equal(saved.result.budgetDeficitMinor, 300100);
});
