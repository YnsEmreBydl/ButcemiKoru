import type { SavedBudget, SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { invalidData } from './guards';
import { decodeBudget } from './validation';

export async function readBudget(tx: SqlSession, asOf: string): Promise<SavedBudget | null> {
  const periods = await tx.all('SELECT * FROM budget_periods ORDER BY id');
  const payments = await tx.all('SELECT * FROM budget_payments ORDER BY id');
  const expenses = await tx.all('SELECT * FROM budget_expenses ORDER BY occurred_at DESC, created_at DESC, id DESC');
  if (periods.length === 0) {
    if (payments.length || expenses.length || (await tx.all('SELECT operation_id FROM budget_save_operations LIMIT 1')).length) invalidData();
    return null;
  }
  if (periods.length !== 1) invalidData();
  return decodeBudget(periods[0], payments, asOf, expenses);
}

export async function requireBudget(tx: SqlSession, asOf: string): Promise<SavedBudget> {
  const saved = await readBudget(tx, asOf);
  if (!saved) throw new BudgetStorageError('NOT_FOUND', 'Önce bir bütçe oluşturun.');
  return saved;
}

export async function advanceRevision(tx: SqlSession, current: SavedBudget, expectedRevision: number): Promise<number> {
  if (current.revision !== expectedRevision) {
    throw new BudgetStorageError('CONFLICT', 'Bütçe bu sırada değişti. Girdileriniz korunuyor; güncel bütçeyi yeniden yükleyip kontrol edin.');
  }
  const next = current.revision + 1;
  if (!Number.isSafeInteger(next)) invalidData();
  const result = await tx.run('UPDATE budget_periods SET revision = ? WHERE id = ? AND revision = ?', [next, 1, expectedRevision]);
  if (result.changes !== 1) throw new BudgetStorageError('CONFLICT', 'Bütçe aynı anda değiştirildi.');
  return next;
}
