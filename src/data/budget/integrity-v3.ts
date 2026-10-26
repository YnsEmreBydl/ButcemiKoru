import type { SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { v3Indexes, v3Triggers } from './schema-v3';
import { decodeBudget } from './validation';

// Names below are trusted schema constants, never user input.
export const legacyColumns = {
  budget_periods: 'id, revision, currency, time_zone, balance_minor, balance_captured_at, next_payday, savings_minor',
  budget_payments: 'period_id, id, name, amount_minor, due_on',
  budget_expenses: 'id, period_id, amount_minor, category, description, occurred_at, created_at, status, cancelled_at',
  budget_save_operations: 'operation_id, period_id, payload, resulting_revision',
} as const;

function fail(): never {
  throw new BudgetStorageError('INVALID_DATA', 'Veritabanı bütünlüğü doğrulanamadı. Eski kayıtlarınız silinmedi.');
}

export async function checkSQLiteIntegrity(tx: SqlSession): Promise<void> {
  const check = await tx.all('PRAGMA integrity_check');
  if (check.length !== 1 || check[0]?.integrity_check !== 'ok') fail();
  // This checks relationships even when enforcement on this connection is disabled.
  if ((await tx.all('PRAGMA foreign_key_check')).length !== 0) fail();
}

export async function checkLegacyData(tx: SqlSession): Promise<void> {
  for (const [table, columns] of Object.entries(legacyColumns)) {
    await tx.all(`SELECT ${columns} FROM ${table} LIMIT 0`);
  }
  await checkSQLiteIntegrity(tx);
  const periods = await tx.all('SELECT * FROM budget_periods');
  const payments = await tx.all('SELECT * FROM budget_payments');
  const expenses = await tx.all('SELECT * FROM budget_expenses');
  const receipts = await tx.all('SELECT * FROM budget_save_operations');
  if (periods.length === 0) {
    if (payments.length || expenses.length || receipts.length) fail();
    return;
  }
  if (periods.length !== 1) fail();
  const period = periods[0];
  // Deterministic validation clock: latest persisted instant, never wall-clock "now".
  const times: number[] = [];
  for (const instant of [period.balance_captured_at, ...expenses.flatMap(row => [row.created_at, row.cancelled_at])]) {
    if (instant === null) continue;
    if (typeof instant !== 'string' || !Number.isSafeInteger(Date.parse(instant))) fail();
    times.push(Date.parse(instant));
  }
  const latest = times.reduce((a, b) => Math.max(a, b));
  try {
    decodeBudget(period, payments, new Date(latest).toISOString(), expenses);
  } catch { fail(); }
  for (const row of receipts) {
    if (row.period_id !== period.id || typeof row.resulting_revision !== 'number' ||
      typeof period.revision !== 'number' || row.resulting_revision > period.revision) fail();
  }
}

/** Verify ALL legacy columns in both directions, not just counts or monetary totals. */
export async function checkCopiedData(tx: SqlSession): Promise<void> {
  for (const [table, columns] of Object.entries(legacyColumns)) {
    const counts = await tx.all(`SELECT
      (SELECT count(*) FROM ${table}) AS old_count,
      (SELECT count(*) FROM v3_${table}) AS new_count`);
    if (counts[0]?.old_count !== counts[0]?.new_count) fail();
    for (const [source, target] of [[table, `v3_${table}`], [`v3_${table}`, table]]) {
      if ((await tx.all(`SELECT ${columns} FROM ${source} EXCEPT SELECT ${columns} FROM ${target} LIMIT 1`)).length) fail();
    }
  }
  await checkSQLiteIntegrity(tx);
}

/** Read-only checks, also used on subsequent opens of an already migrated TEST database. */
export async function checkV3Integrity(tx: SqlSession): Promise<void> {
  await tx.all('SELECT id, public_id, activation_revision FROM budget_books LIMIT 0');
  await tx.all(`SELECT ${legacyColumns.budget_periods}, public_id, book_id, previous_period_id,
    status, opened_at, created_at, closed_at, closing_result_json, calculation_version FROM budget_periods LIMIT 0`);
  await tx.all(`SELECT ${legacyColumns.budget_payments}, public_id, carried_from_period_id, carried_from_payment_id FROM budget_payments LIMIT 0`);
  await tx.all(`SELECT ${legacyColumns.budget_expenses}, public_id FROM budget_expenses LIMIT 0`);
  await tx.all(`SELECT ${legacyColumns.budget_save_operations}, public_id, book_id, source_period_id, kind, command_version FROM budget_save_operations LIMIT 0`);
  for (const [type, names] of [['index', v3Indexes], ['trigger', v3Triggers]] as const) {
    const rows = await tx.all('SELECT name FROM sqlite_schema WHERE type = ?', [type]);
    if (names.some(name => !rows.some(row => row.name === name))) fail();
  }
  await checkSQLiteIntegrity(tx);
  const invalid = await tx.all(`
    SELECT id FROM budget_periods p WHERE
      NOT EXISTS (SELECT 1 FROM budget_books WHERE id = p.book_id) OR
      (previous_period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM budget_periods s
        WHERE s.id = p.previous_period_id AND s.book_id = p.book_id AND s.status = 'closed' AND s.closed_at = p.opened_at))
    UNION ALL
    SELECT period_id FROM budget_payments t WHERE carried_from_period_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM budget_payments s JOIN budget_periods p ON p.id = s.period_id
      JOIN budget_periods target ON target.id = t.period_id WHERE
      s.period_id = t.carried_from_period_id AND s.id = t.carried_from_payment_id AND
      p.status = 'closed' AND p.book_id = target.book_id AND target.previous_period_id = p.id)
    UNION ALL
    SELECT period_id FROM budget_save_operations o WHERE NOT EXISTS (
      SELECT 1 FROM budget_periods p WHERE p.id = o.period_id AND p.book_id = o.book_id AND p.revision >= o.resulting_revision) OR
      (source_period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM budget_periods s JOIN budget_periods t ON t.id = o.period_id
        WHERE s.id = o.source_period_id AND s.book_id = o.book_id AND s.status = 'closed' AND t.previous_period_id = s.id))
    LIMIT 1`);
  if (invalid.length) fail();
}
