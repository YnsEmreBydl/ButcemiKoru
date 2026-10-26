import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateDatabase, migrations, SCHEMA_VERSION } from '../../src/data/budget/migrations';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { decodeBudget } from '../../src/data/budget/validation';
import { databaseFixture, type RealSQLite } from '../storage/sqlite-helper';
import { failAfter, legacyFixture, oldRows, snapshot } from './fixtures';

test('v3: v1 and v2 SQL fixtures stay frozen', () => {
  assert.equal(migrations[0].sql, readFileSync(join(process.cwd(), 'tests/expenses/v1-schema.sql'), 'utf8'));
  assert.equal(migrations.map(m => m.sql).join('\n'), readFileSync(join(process.cwd(), 'tests/migrations-v3/fixtures/v2-schema.sql'), 'utf8'));
});

for (const foreignKeys of [0, 1]) {
  for (const version of [0, 1, 2] as const) {
    test(`v3: real file ${version} -> 3, foreign_keys=${foreignKeys}, preserves every legacy column`, async t => {
      const db = databaseFixture(t).open();
      if (version) legacyFixture(db, version);
      const old = version ? oldRowsWithOptionalExpenses(db, version) : null;
      db.db.exec(`PRAGMA foreign_keys=${foreignKeys}`);
      await migrateDatabaseV3(db);
      assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 3);
      assert.equal(db.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, foreignKeys);
      assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_books').get()?.n, 1);
      assert.equal(db.db.prepare('SELECT activation_revision FROM budget_books').get()?.activation_revision, version ? 1 : 0);
      if (old) {
        assert.deepEqual(oldRows(db), old);
        assert.equal(db.db.prepare('SELECT opened_at FROM budget_periods').get()?.opened_at, '2026-10-20T06:00:00.000Z');
        assert.equal(db.db.prepare('SELECT created_at FROM budget_periods').get()?.created_at, null); // No invented creation time.
        assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_save_operations WHERE kind='legacy' AND command_version=0 AND book_id=1 AND source_period_id IS NULL").get()?.n, 4);
      } else assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 0);
    });
  }
}

// v1 intentionally has no expense table. Existing fixture is not rewritten to include one.
function oldRowsWithOptionalExpenses(db: RealSQLite, version: 1 | 2) {
  if (version === 2) return oldRows(db);
  return {
    budget_periods: db.db.prepare('SELECT * FROM budget_periods ORDER BY 1,2').all(),
    budget_payments: db.db.prepare('SELECT * FROM budget_payments ORDER BY 1,2').all(),
    budget_expenses: [],
    budget_save_operations: db.db.prepare('SELECT * FROM budget_save_operations ORDER BY 1,2').all(),
  };
}

test('v3: repeated migration and file reopen preserve all public identities and rows', async t => {
  const files = databaseFixture(t); const db = files.open(); legacyFixture(db, 2);
  await migrateDatabaseV3(db); const before = snapshot(db);
  await migrateDatabaseV3(db); assert.deepEqual(snapshot(db), before);
  db.close(); const reopened = files.open(); await migrateDatabaseV3(reopened);
  assert.deepEqual(snapshot(reopened), before);
  const ids: string[] = [];
  for (const table of ['budget_books', 'budget_periods', 'budget_payments', 'budget_expenses', 'budget_save_operations']) {
    for (const row of reopened.db.prepare(`SELECT public_id FROM ${table}`).all()) {
      assert.equal(typeof row.public_id, 'string');
      if (typeof row.public_id !== 'string') throw Error('fixture type');
      assert.match(row.public_id, /^[0-9a-f]{32}$/); ids.push(row.public_id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
});

for (const version of [0, 1, 2] as const) {
  for (const marker of ['v3:create', 'v3:books', 'v3:copy', 'v3:replace', 'v3:guards', 'PRAGMA user_version = 3']) {
    test(`v3: rollback source=${version} after ${marker} restores schema, data and version`, async t => {
      const files = databaseFixture(t); const db = files.open(); if (version) legacyFixture(db, version);
      const before = snapshot(db);
      await assert.rejects(migrateDatabaseV3(failAfter(db, marker)), /Injected migration failure/);
      assert.deepEqual(snapshot(db), before);
      db.close(); const reopened = files.open(); assert.deepEqual(snapshot(reopened), before);
      // A failure does not poison the connection or prevent a later successful migration.
      await migrateDatabaseV3(reopened); assert.equal(reopened.db.prepare('PRAGMA user_version').get()?.user_version, 3);
    });
  }
}

test('v3: equal row counts with a changed copied amount are detected before tables are replaced', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2); const before = snapshot(db);
  await assert.rejects(migrateDatabaseV3(failAfter(db, 'v3:copy', true)), { code: 'INVALID_DATA' });
  assert.deepEqual(snapshot(db), before);
});

test('v3: failure during final integrity validation also rolls back the rebuilt schema', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2); const before = snapshot(db);
  const broken = { transaction: <T>(task: Parameters<typeof db.transaction<T>>[0]) => db.transaction(tx => task({ ...tx,
    exec: async (sql: string) => { await tx.exec(sql); if (sql.includes('v3:guards')) await tx.exec('DROP TRIGGER expense_keep_history'); },
  })) };
  await assert.rejects(migrateDatabaseV3(broken), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
});

test('v3: invalid legacy calendar input fails without silently repairing or deleting rows', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2);
  db.db.exec("UPDATE budget_payments SET due_on='2026-02-30' WHERE id='rent'"); const before = snapshot(db);
  await assert.rejects(migrateDatabaseV3(db), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
});

test('v3: orphan legacy rows are detected even with foreign_keys OFF', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2);
  db.db.exec("PRAGMA foreign_keys=OFF; DROP TRIGGER expense_parent_insert; INSERT INTO budget_expenses VALUES('orphan',1,1,'food','','2026-10-21T08:00:00.000Z','2026-10-21T08:00:00.000Z','active',NULL); DROP TRIGGER period_keep_expenses; DROP TRIGGER period_delete_children; DELETE FROM budget_periods");
  const before = snapshot(db); await assert.rejects(migrateDatabaseV3(db)); assert.deepEqual(snapshot(db), before);
});

test('v3: future schema versions and legacy rename mode are refused without reset', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2);
  db.db.exec('PRAGMA user_version=4'); let before = snapshot(db);
  await assert.rejects(migrateDatabaseV3(db), { code: 'MIGRATION' }); assert.deepEqual(snapshot(db), before);
  db.db.exec('PRAGMA user_version=2; PRAGMA legacy_alter_table=ON'); before = snapshot(db);
  await assert.rejects(migrateDatabaseV3(db), { code: 'MIGRATION' }); assert.deepEqual(snapshot(db), before);
});

test('v3: missing guard in an already v3 database is rejected rather than repaired/reset', async t => {
  const db = databaseFixture(t).open(); await migrateDatabaseV3(db);
  db.db.exec('DROP TRIGGER operation_immutable'); const before = snapshot(db);
  await assert.rejects(migrateDatabaseV3(db), { code: 'INVALID_DATA' }); assert.deepEqual(snapshot(db), before);
});

test('v3: stage 7A leaves the application migration entry on v2', async t => {
  assert.equal(SCHEMA_VERSION, 2);
  const nativeSource = readFileSync(join(process.cwd(), 'src/data/budget/platform.native.ts'), 'utf8');
  assert.match(nativeSource, /from '.\/migrations'/); assert.doesNotMatch(nativeSource, /migrations-v3/);
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  assert.equal(db.db.prepare('PRAGMA user_version').get()?.user_version, 2);
  await migrateDatabaseV3(db); const before = snapshot(db);
  await assert.rejects(migrateDatabase(db), { code: 'MIGRATION' }); assert.deepEqual(snapshot(db), before);
});

test('v3: cancelled and inclusive snapshot history have identical domain results before and after migration', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2);
  const result = () => {
    const period = db.db.prepare('SELECT * FROM budget_periods').get();
    if (!period) throw Error('fixture type');
    return decodeBudget(period, db.db.prepare('SELECT * FROM budget_payments').all(),
      '2026-10-25T12:00:00.000Z', db.db.prepare('SELECT * FROM budget_expenses').all()).result;
  };
  const before = result(); assert.equal(before.spentSinceSnapshotMinor, 101); assert.equal(before.remainingBalanceMinor, 999899);
  await migrateDatabaseV3(db); assert.deepEqual(result(), before);
});

for (const version of [1, 2] as const) {
  for (const [phase, boundary] of [['v3:copy', 'INSERT INTO v3_budget_expenses'], ['v3:replace', 'ALTER TABLE v3_budget_books']] as const) {
    test(`v3: partial SQL batch ${phase} from v${version} rolls back all previous statements`, async t => {
      const db = databaseFixture(t).open(); legacyFixture(db, version); const before = snapshot(db);
      const interrupted = { transaction: <T>(task: Parameters<typeof db.transaction<T>>[0]) => db.transaction(tx => task({ ...tx,
        exec: async (sql: string) => {
          if (!sql.includes(phase)) { await tx.exec(sql); return; }
          const cut = sql.indexOf(boundary); assert.ok(cut > 0);
          await tx.exec(sql.slice(0, cut)); // Real copied rows / dropped tables inside SQLite.
          throw Error('Interrupted partial SQL batch');
        },
      })) };
      await assert.rejects(migrateDatabaseV3(interrupted), /Interrupted partial SQL batch/);
      assert.deepEqual(snapshot(db), before);
    });
  }
}

test('v3: pre-commit failure is propagated and no schema version is exposed as successful', async t => {
  const db = databaseFixture(t).open(); legacyFixture(db, 2); const before = snapshot(db);
  const interrupted = { transaction: <T>(task: Parameters<typeof db.transaction<T>>[0]) => db.transaction(async tx => {
    await task(tx); // Includes all checks and user_version=3, but has not committed yet.
    throw Error('Injected pre-commit failure');
  }) };
  await assert.rejects(migrateDatabaseV3(interrupted), /Injected pre-commit failure/); assert.deepEqual(snapshot(db), before);
});

for (const capturedAt of ['2026-10-20T09:00:00+23:59', '2026-10-20T09:00:00.123+05:45']) {
  test(`v3: domain-valid legacy offset ${capturedAt} is preserved and normalized only in new metadata`, async t => {
    const db = databaseFixture(t).open(); legacyFixture(db, 2, capturedAt); const before = oldRows(db);
    await migrateDatabaseV3(db); assert.deepEqual(oldRows(db), before);
    assert.equal(db.db.prepare('SELECT opened_at FROM budget_periods').get()?.opened_at, new Date(capturedAt).toISOString());
  });
}
