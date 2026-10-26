import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { calculateBudget } from '../../src/domain/budget';
import { budget } from '../budget/fixtures';
import { databaseFixture } from '../storage/sqlite-helper';
import { closeFixturePeriod, closedAt, insertExpense, insertPeriod, legacyFixture, snapshot } from './fixtures';

async function fixture(t: TestContext, foreignKeys = 1) {
  const files = databaseFixture(t); const db = files.open(); legacyFixture(db, 2);
  db.db.exec(`PRAGMA foreign_keys=${foreignKeys}`);
  await migrateDatabaseV3(db); return { files, db };
}

for (const foreignKeys of [0, 1]) {
  test(`v3 constraints FK=${foreignKeys}: active singleton, predecessor and book ownership`, async t => {
    const { db } = await fixture(t, foreignKeys);
    assert.throws(() => insertPeriod(db, 2, 1, null)); // second active/root
    assert.throws(() => insertPeriod(db)); // predecessor still active
    assert.throws(() => insertPeriod(db, 2, 999, null));
    closeFixturePeriod(db); insertPeriod(db);
    // A separate book can have its own active root, but cannot borrow a predecessor.
    db.db.exec('INSERT INTO budget_books (id, activation_revision) VALUES (2,0)');
    assert.throws(() => insertPeriod(db, 3, 2, 1));
    insertPeriod(db, 3, 2, null);
    db.db.prepare("UPDATE budget_periods SET status='closed', closed_at=?, closing_result_json=?, calculation_version=? WHERE id=2")
      .run('2026-12-04T06:00:00.000Z', JSON.stringify(calculateBudget(budget({ asOf: '2026-12-04T06:00:00.000Z' }))), 'test');
    // No active conflict now: a second direct successor must still be rejected.
    assert.throws(() => insertPeriod(db, 4, 1, 1));
    assert.throws(() => insertPeriod(db, 4, 1, 4));
    assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test(`v3 constraints FK=${foreignKeys}: closed financial rows and receipts are immutable`, async t => {
    const { db } = await fixture(t, foreignKeys); closeFixturePeriod(db); const before = snapshot(db);
    for (const sql of [
      'UPDATE budget_periods SET balance_minor=1 WHERE id=1',
      'UPDATE budget_periods SET savings_minor=1 WHERE id=1',
      "UPDATE budget_periods SET next_payday='2027-01-01' WHERE id=1",
      "UPDATE budget_periods SET status='active', closed_at=NULL, closing_result_json=NULL, calculation_version=NULL WHERE id=1",
      "UPDATE budget_periods SET closing_result_json='{}' WHERE id=1",
      'DELETE FROM budget_periods WHERE id=1',
      "UPDATE budget_payments SET amount_minor=1 WHERE id='rent'",
      "DELETE FROM budget_payments WHERE id='rent'",
      "INSERT INTO budget_payments(period_id,id,name,amount_minor,due_on) VALUES(1,'new','Fatura',1,'2026-10-30')",
      "UPDATE budget_expenses SET status='cancelled',cancelled_at='2026-11-05T00:00:00.000Z' WHERE id='active-old'",
      "DELETE FROM budget_expenses WHERE id='active-old'",
      "UPDATE budget_save_operations SET payload='{}' WHERE operation_id='kurulum-id'",
      "DELETE FROM budget_save_operations WHERE operation_id='kurulum-id'",
      "INSERT INTO budget_save_operations(operation_id,book_id,period_id,kind,command_version,payload,resulting_revision) VALUES('new',1,1,'budget-save',1,'{}',1)",
      'DELETE FROM budget_books WHERE id=1',
    ]) assert.throws(() => db.db.exec(sql), sql);
    assert.throws(() => insertExpense(db, 1));
    assert.deepEqual(snapshot(db), before);
  });

  test(`v3 constraints FK=${foreignKeys}: invoice carry provenance and receipt scope`, async t => {
    const { db } = await fixture(t, foreignKeys); closeFixturePeriod(db); insertPeriod(db);
    const insert = db.db.prepare(`INSERT INTO budget_payments
      (period_id,id,name,amount_minor,due_on,carried_from_period_id,carried_from_payment_id) VALUES(?,?,?,?,?,?,?)`);
    insert.run(2, 'new-rent', 'Kira', 200000, '2026-11-28', 1, 'rent');
    assert.throws(() => insert.run(2, 'duplicate', 'Kira', 200000, '2026-11-28', 1, 'rent'));
    assert.throws(() => insert.run(2, 'missing-source', 'Kira', 1, '2026-11-28', 1, 'missing'));
    assert.throws(() => insert.run(2, 'half-source', 'Kira', 1, '2026-11-28', 1, null));
    assert.throws(() => insert.run(999, 'missing-period', 'Kira', 1, '2026-11-28', null, null));
    assert.throws(() => db.db.exec("UPDATE budget_payments SET carried_from_payment_id='fatura/İstanbul' WHERE id='new-rent'"));
    const receipt = db.db.prepare(`INSERT INTO budget_save_operations
      (operation_id,book_id,period_id,source_period_id,kind,command_version,payload,resulting_revision) VALUES(?,?,?,?,?,?,?,?)`);
    receipt.run('open-two', 1, 2, 1, 'period-open', 1, '{}', 1);
    assert.throws(() => receipt.run('wrong-book', 2, 2, 1, 'period-open', 1, '{}', 1));
    assert.throws(() => receipt.run('wrong-source', 1, 2, 999, 'period-open', 1, '{}', 1));
    assert.throws(() => receipt.run('wrong-revision', 1, 2, null, 'expense-add', 1, '{}', 2));
    assert.throws(() => receipt.run('wrong-version', 1, 2, null, 'expense-add', 2, '{}', 1));
    assert.throws(() => receipt.run('bad-json', 1, 2, null, 'expense-add', 1, 'not json', 1));
    assert.throws(() => receipt.run('fake-legacy', 1, 2, null, 'legacy', 0, 'opaque', 1));
    // New book/root exists: cross-book references must still be rejected.
    db.db.exec('INSERT INTO budget_books (id,activation_revision) VALUES(2,0)'); insertPeriod(db, 3, 2, null);
    assert.throws(() => insert.run(3, 'cross-book', 'Kira', 1, '2026-11-28', 1, 'rent'));
    assert.throws(() => receipt.run('cross-book-source', 2, 3, 1, 'period-open', 1, '{}', 1));
    await migrateDatabaseV3(db); // Read-only integrity pass also understands valid archived relations.
  });
}

test('v3 constraints: replacement conflict algorithms cannot overwrite archived records with recursive_triggers OFF', async t => {
  const { db } = await fixture(t, 0); db.db.exec('PRAGMA recursive_triggers=OFF'); closeFixturePeriod(db); insertPeriod(db);
  const before = snapshot(db);
  for (const sql of [
    'INSERT OR REPLACE INTO budget_books SELECT * FROM budget_books WHERE id=1',
    'INSERT OR REPLACE INTO budget_periods SELECT * FROM budget_periods WHERE id=1',
    "INSERT OR REPLACE INTO budget_payments SELECT * FROM budget_payments WHERE id='rent'",
    "INSERT OR REPLACE INTO budget_expenses SELECT * FROM budget_expenses WHERE id='active-old'",
    "INSERT OR REPLACE INTO budget_save_operations SELECT * FROM budget_save_operations WHERE operation_id='kurulum-id'",
    // Collide through public_id, using a different local identity/active target.
    "INSERT OR REPLACE INTO budget_payments(period_id,id,public_id,name,amount_minor,due_on) SELECT 2,'attack',public_id,'Kira',1,'2026-11-28' FROM budget_payments WHERE id='rent'",
    "INSERT OR REPLACE INTO budget_expenses(id,public_id,period_id,amount_minor,category,description,occurred_at,created_at) SELECT 'attack',public_id,2,1,'food','','2026-11-05T08:00:00.000Z','2026-11-05T08:00:00.000Z' FROM budget_expenses WHERE id='active-old'",
  ]) assert.throws(() => db.db.exec(sql), sql);
  assert.deepEqual(snapshot(db), before);
});

test('v3 constraints: active expense cancellation is one-way and never deletes history', async t => {
  const { db } = await fixture(t); closeFixturePeriod(db); insertPeriod(db); insertExpense(db, 2);
  assert.throws(() => insertExpense(db, 999, 'orphan'));
  assert.throws(() => db.db.exec("UPDATE budget_expenses SET period_id=1 WHERE id='new-expense'"));
  assert.throws(() => db.db.exec("UPDATE budget_expenses SET amount_minor=124 WHERE id='new-expense'"));
  db.db.exec("UPDATE budget_expenses SET status='cancelled',cancelled_at='2026-11-05T09:00:00.000Z' WHERE id='new-expense'");
  assert.throws(() => db.db.exec("UPDATE budget_expenses SET status='active',cancelled_at=NULL WHERE id='new-expense'"));
  assert.throws(() => db.db.exec("UPDATE budget_expenses SET cancelled_at='2026-11-05T10:00:00.000Z' WHERE id='new-expense'"));
  assert.throws(() => db.db.exec("DELETE FROM budget_expenses WHERE id='new-expense'"));
  assert.throws(() => db.db.exec('UPDATE budget_periods SET balance_minor=123 WHERE id=2')); // Cancelled history still locks opening.
});

test('v3 constraints: new expenses at or before the opening are rejected; migrated historical rows stay intact', async t => {
  const { db } = await fixture(t);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_expenses WHERE id IN ('historical-old','exact-snapshot')").get()?.n, 2);
  assert.throws(() => db.db.exec(`INSERT INTO budget_expenses(id,period_id,amount_minor,category,description,occurred_at,created_at)
    VALUES('pre-opening',1,1,'other','','2026-10-20T06:00:00.000Z','2026-10-25T09:00:00.000Z')`));
});

test('v3 constraints: safe INTEGER money, public identities and revisions', async t => {
  const { db } = await fixture(t);
  for (const amount of [0, -1, 0.01, 9007199254740992, Infinity, NaN]) {
    assert.throws(() => db.db.prepare('UPDATE budget_payments SET amount_minor=? WHERE id=?').run(amount, 'rent'));
  }
  db.db.exec("UPDATE budget_payments SET amount_minor=9007199254740991 WHERE id='rent'");
  assert.equal(db.db.prepare("SELECT typeof(amount_minor) AS t FROM budget_payments WHERE id='rent'").get()?.t, 'integer');
  for (const sql of [
    'UPDATE budget_periods SET revision=0 WHERE id=1',
    'UPDATE budget_periods SET revision=4 WHERE id=1',
    'UPDATE budget_books SET activation_revision=-1 WHERE id=1',
    "UPDATE budget_books SET public_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=1",
    "UPDATE budget_periods SET public_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=1",
    "UPDATE budget_payments SET public_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id='rent'",
    "UPDATE budget_expenses SET public_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id='active-old'",
  ]) assert.throws(() => db.db.exec(sql), sql);
});

test('v3 constraints: closing requires an integer snapshot and cannot rewrite financial inputs', async t => {
  const { db } = await fixture(t);
  const close = db.db.prepare("UPDATE budget_periods SET status='closed',closed_at=?,closing_result_json=?,calculation_version=? WHERE id=1");
  for (const json of ['not-json', '{}', '{"currency":"TRY"}', JSON.stringify({ ...calculateBudget(budget()), spendableMinor: 0.5 }),
    JSON.stringify({ ...calculateBudget(budget()), daily: { ...calculateBudget(budget()).daily, todayRemainingMinor: 0.1 } })]) {
    assert.throws(() => close.run(closedAt, json, 'v1'));
  }
  const validJSON = JSON.stringify(calculateBudget(budget({ asOf: closedAt })));
  assert.throws(() => close.run(closedAt, validJSON, ''));
  assert.throws(() => close.run('2026-11-40T00:00:00.000Z', validJSON, 'v1'));
  assert.throws(() => close.run('2026-10-21T00:00:00.000Z', validJSON, 'v1')); // Later recorded expenses/cancellations exist.
  assert.throws(() => db.db.prepare("UPDATE budget_periods SET status='closed',closed_at=?,closing_result_json=?,calculation_version='v1',savings_minor=1 WHERE id=1").run(closedAt, validJSON));
  closeFixturePeriod(db); assert.equal(db.db.prepare('SELECT status FROM budget_periods').get()?.status, 'closed');
});

test('v3 constraints: two connections cannot commit two successors of one source', async t => {
  const { db, files } = await fixture(t); closeFixturePeriod(db);
  const second = files.open(); second.db.exec('PRAGMA busy_timeout=1');
  db.db.exec('BEGIN IMMEDIATE');
  try {
    insertPeriod(db);
    assert.throws(() => second.db.exec('BEGIN IMMEDIATE'), /locked/);
    db.db.exec('COMMIT');
  } catch (error) { if (db.db.isTransaction) db.db.exec('ROLLBACK'); throw error; }
  assert.throws(() => insertPeriod(second, 3));
  assert.equal(second.db.prepare('SELECT count(*) AS n FROM budget_periods WHERE previous_period_id=1').get()?.n, 1);
});

test('v3 constraints: REPLACE cannot resolve active/root/successor or invoice provenance uniqueness by deleting rows', async t => {
  const { db } = await fixture(t, 0); db.db.exec('PRAGMA recursive_triggers=OFF'); let before = snapshot(db);
  const replacePeriod = db.db.prepare(`INSERT OR REPLACE INTO budget_periods
    (id,book_id,previous_period_id,status,opened_at,revision,currency,time_zone,balance_minor,balance_captured_at,next_payday,savings_minor)
    VALUES(?,1,?,'active',?,1,'TRY','Europe/Istanbul',1,?,'2026-12-04',0)`);
  assert.throws(() => replacePeriod.run(9, null, closedAt, closedAt));
  assert.deepEqual(snapshot(db), before);
  closeFixturePeriod(db); insertPeriod(db);
  db.db.exec(`INSERT INTO budget_payments(period_id,id,name,amount_minor,due_on,carried_from_period_id,carried_from_payment_id)
    VALUES(2,'copied-rent','Kira',1,'2026-11-28',1,'rent')`);
  before = snapshot(db);
  assert.throws(() => replacePeriod.run(9, 1, closedAt, closedAt));
  assert.throws(() => db.db.exec(`INSERT OR REPLACE INTO budget_payments
    (period_id,id,name,amount_minor,due_on,carried_from_period_id,carried_from_payment_id)
    VALUES(2,'second-copy','Kira',2,'2026-11-28',1,'rent')`));
  assert.deepEqual(snapshot(db), before);
});
