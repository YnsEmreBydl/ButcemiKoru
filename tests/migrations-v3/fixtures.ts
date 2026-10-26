import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AtomicDatabase, SqlRow } from '../../src/data/budget/contracts';
import { legacyColumns } from '../../src/data/budget/integrity-v3';
import { calculateBudget } from '../../src/domain/budget';
import { budget } from '../budget/fixtures';
import type { RealSQLite } from '../storage/sqlite-helper';

export function legacyFixture(db: RealSQLite, version: 1 | 2, capturedAt = '2026-10-20T09:00:00+03:00'): void {
  const file = version === 1 ? 'tests/expenses/v1-schema.sql' : 'tests/migrations-v3/fixtures/v2-schema.sql';
  db.db.exec(readFileSync(join(process.cwd(), file), 'utf8'));
  db.db.exec(`PRAGMA user_version = ${version}`);
  db.db.prepare('INSERT INTO budget_periods VALUES (?,?,?,?,?,?,?,?)')
    .run(1, 5, 'TRY', 'Europe/Istanbul', 1_000_000, capturedAt, '2026-11-04', 100_000);
  db.db.prepare('INSERT INTO budget_payments VALUES (?,?,?,?,?)').run(1, 'fatura/İstanbul', 'Elektrik', 12345, '2026-10-29');
  db.db.prepare('INSERT INTO budget_payments VALUES (?,?,?,?,?)').run(1, 'rent', 'Kira', 200000, '2026-10-28');
  for (const [id, payload, revision] of [
    ['kurulum-id', ' { "expectedRevision": null, "old": true }\n', 1],
    ['expense-old-op', '{"expenseId":"active-old"}', 2],
    ['cancel-old-op', 'opaque legacy receipt: değiştirme', 3],
    ['empty-legacy', '', 4],
  ] as const) {
    db.db.prepare('INSERT INTO budget_save_operations VALUES (?,?,?,?)').run(id, 1, payload, revision);
  }
  if (version === 2) {
    for (const [id, occurredAt, status, cancelledAt] of [
      ['active-old', '2026-10-25T08:00:00.000Z', 'active', null],
      ['cancelled-old', '2026-10-23T08:00:00.000Z', 'cancelled', '2026-10-25T09:00:00.000Z'],
      ['historical-old', '2026-10-19T08:00:00.000Z', 'active', null],
      ['exact-snapshot', '2026-10-20T06:00:00.000Z', 'active', null],
    ] as const) {
      db.db.prepare('INSERT INTO budget_expenses VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, 1, 101, 'market', 'Örnek açıklama', occurredAt, '2026-10-25T08:30:00.000Z', status, cancelledAt);
    }
  }
}

export function oldRows(db: RealSQLite): Record<string, SqlRow[]> {
  return Object.fromEntries(Object.entries(legacyColumns).map(([table, columns]) => [table,
    db.db.prepare(`SELECT ${columns} FROM ${table} ORDER BY 1, 2`).all(),
  ]));
}

/** Full logical schema + data + version snapshot, for proof that failures leave v1/v2 intact. */
export function snapshot(db: RealSQLite) {
  const schema = db.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const data = schema.filter(row => row.type === 'table').map(row => {
    assert.equal(typeof row.name, 'string');
    // All names come from these isolated fixtures, not application input.
    return [row.name, db.db.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`).all()];
  });
  return { version: db.db.prepare('PRAGMA user_version').get(), schema, data };
}

/** Fault injection around REAL SQL and a REAL transaction, not a database mock. */
export function failAfter(database: AtomicDatabase, marker: string, tamper = false): AtomicDatabase {
  return {
    transaction: task => database.transaction(tx => task({ ...tx,
      exec: async sql => {
        await tx.exec(sql);
        if (!sql.includes(marker)) return;
        if (tamper) await tx.run('UPDATE v3_budget_payments SET amount_minor = amount_minor + ? WHERE id = ?', [1, 'rent']);
        else throw new Error('Injected migration failure');
      },
    })),
  };
}

export const closedAt = '2026-11-04T06:00:00.000Z';
export function closeFixturePeriod(db: RealSQLite): void {
  const transactions = db.db.prepare("SELECT id, amount_minor, occurred_at FROM budget_expenses WHERE period_id=1 AND status='active'").all().map(row => {
    assert.equal(typeof row.id, 'string'); assert.equal(typeof row.amount_minor, 'number'); assert.equal(typeof row.occurred_at, 'string');
    if (typeof row.id !== 'string' || typeof row.amount_minor !== 'number' || typeof row.occurred_at !== 'string') throw Error('fixture type');
    return { kind: 'expense' as const, id: row.id, amountMinor: row.amount_minor, occurredAt: row.occurred_at };
  });
  const closingResult = calculateBudget(budget({ asOf: closedAt, transactions,
    payments: [{ id: 'rent', amountMinor: 200000, dueOn: '2026-10-28' }, { id: 'fatura/İstanbul', amountMinor: 12345, dueOn: '2026-10-29' }],
  }));
  db.db.prepare("UPDATE budget_periods SET status='closed', closed_at=?, closing_result_json=?, calculation_version=? WHERE id=1")
    .run(closedAt, JSON.stringify(closingResult), 'budget-engine-v1');
}

// Direct SQL fixture for constraint tests; NOT the future startPeriod business operation.
export function insertPeriod(db: RealSQLite, id = 2, bookId = 1, previousId: number | null = 1): void {
  db.db.prepare(`INSERT INTO budget_periods
    (id, book_id, previous_period_id, status, opened_at, created_at, revision, currency, time_zone,
     balance_minor, balance_captured_at, next_payday, savings_minor)
    VALUES (?, ?, ?, 'active', ?, ?, 1, 'TRY', 'Europe/Istanbul', 100000, ?, '2026-12-04', 0)`)
    .run(id, bookId, previousId, closedAt, closedAt, closedAt);
}

export function insertExpense(db: RealSQLite, periodId: number, id = 'new-expense'): void {
  db.db.prepare(`INSERT INTO budget_expenses (id, period_id, amount_minor, category, description, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, periodId, 123, 'food', '', '2026-11-05T08:00:00.000Z', '2026-11-05T08:00:01.000Z');
}
