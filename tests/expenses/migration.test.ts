import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateDatabase, migrations } from '../../src/data/budget/migrations';
import { createBudgetRepository } from '../../src/data/budget/repository';
import { validateCommand } from '../../src/data/budget/validation';
import { command, databaseFixture } from '../storage/sqlite-helper';
import { add, fixture, now } from './fixtures';

test('Expense migration: frozen v1 schema and all existing budget data survive v2', async (t) => {
  const db = databaseFixture(t).open();
  const oldSQL = readFileSync(join(process.cwd(), 'tests/expenses/v1-schema.sql'), 'utf8');
  assert.equal(migrations[0].sql, oldSQL);
  db.db.exec(oldSQL); db.db.exec('PRAGMA user_version=1');
  const input = command().input;
  db.db.prepare('INSERT INTO budget_periods VALUES (?,?,?,?,?,?,?,?)').run(1, 1, 'TRY', input.timeZone, input.balanceSnapshot.amountMinor, input.balanceSnapshot.capturedAt, input.nextPayday, input.savingsTargetMinor);
  db.db.prepare('INSERT INTO budget_payments VALUES (?,?,?,?,?)').run(1, 'rent', 'Kira', 200000, '2026-10-28');
  db.db.prepare('INSERT INTO budget_save_operations VALUES (?,?,?,?)').run('create-1', 1, validateCommand(command()).payload, 1);
  const tables = ['budget_periods', 'budget_payments', 'budget_save_operations'];
  const before = tables.map(table => db.db.prepare(`SELECT * FROM ${table}`).all());
  await migrateDatabase(db);
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 2);
  assert.deepEqual(tables.map(table => db.db.prepare(`SELECT * FROM ${table}`).all()), before);
  const repo = createBudgetRepository(db);
  assert.equal((await repo.save(command())).revision, 1); // Existing v1 receipt is still valid.
  assert.equal((await repo.addExpense(add())).revision, 2);
});

test('Expense migration: failed v2 keeps v1 version, budget and invoices intact', async (t) => {
  const db = databaseFixture(t).open();
  db.db.exec(readFileSync(join(process.cwd(), 'tests/expenses/v1-schema.sql'), 'utf8'));
  db.db.exec("PRAGMA user_version=1; INSERT INTO budget_periods VALUES(1,1,'TRY','Europe/Istanbul',100,'2026-10-20T06:00:00Z','2026-11-04',0); INSERT INTO budget_payments VALUES(1,'one','Fatura',1,'2026-10-28'); CREATE TABLE budget_expenses (legacy TEXT)");
  await assert.rejects(migrateDatabase(db));
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 1);
  assert.equal(db.db.prepare('SELECT balance_minor FROM budget_periods').get()?.balance_minor, 100);
  assert.equal(db.db.prepare('SELECT name FROM budget_payments').get()?.name, 'Fatura');
});

test('Expense migration: reopening v2 preserves expense rows and operation receipts', async (t) => {
  const { db, files, repo } = await fixture(t);
  const saved = await repo.addExpense(add()); db.close();
  const reopened = files.open(); await migrateDatabase(reopened); await migrateDatabase(reopened);
  assert.deepEqual(await createBudgetRepository(reopened).load(now), saved);
  assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM budget_save_operations').get()?.n, 2);
});
