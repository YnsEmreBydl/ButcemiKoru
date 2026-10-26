import { calendarDateAt, calendarDaysBetween } from '../../domain/budget';

import type { AddExpenseCommand, AtomicDatabase, BudgetRepository, CancelExpenseCommand, SavedBudget, SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { assertCalculation, identifier, normalizeInstant, sameExpenseData, validateExpenseData, validateMutation } from './expense-validation';
import { integer, invalidData } from './guards';
import { advanceRevision, requireBudget } from './records';

type Serial = <T>(task: () => Promise<T>) => Promise<T>;

async function isReplay(tx: SqlSession, id: string, payload: string, current: SavedBudget): Promise<boolean> {
  const rows = await tx.all('SELECT payload, resulting_revision FROM budget_save_operations WHERE operation_id = ?', [id]);
  if (!rows.length) return false;
  if (rows[0].payload !== payload) throw new BudgetStorageError('CONFLICT', 'Bu işlem kimliği farklı bir kayıt için kullanılmış.');
  const revision = integer(rows[0].resulting_revision);
  if (revision < 1 || revision > current.revision) invalidData();
  return true;
}

async function finish(tx: SqlSession, operationId: string, payload: string, revision: number, asOf: string): Promise<SavedBudget> {
  await tx.run('INSERT INTO budget_save_operations (operation_id, period_id, payload, resulting_revision) VALUES (?, ?, ?, ?)', [operationId, 1, payload, revision]);
  return requireBudget(tx, asOf);
}

export function createExpenseOperations(database: AtomicDatabase, serial: Serial): Pick<BudgetRepository, 'addExpense' | 'cancelExpense'> {
  return {
    addExpense(request: AddExpenseCommand) {
      const command = { ...request, expense: { ...request.expense } };
      return serial(async () => {
        validateMutation(command.operationId, command.periodId, command.expectedRevision, command.asOf);
        const expense = validateExpenseData(command.expense, command.asOf);
        const payload = JSON.stringify({ kind: 'expense-add', periodId: command.periodId, expectedRevision: command.expectedRevision, expense });
        return database.transaction(async (tx) => {
          const current = await requireBudget(tx, command.asOf);
          if (await isReplay(tx, command.operationId, payload, current)) {
            const stored = current.expenses.find((row) => row.id === expense.id);
            if (!stored || !sameExpenseData(stored, expense)) invalidData();
            return current;
          }
          if (current.result.requiresNewPeriod) throw new BudgetStorageError('NEW_PERIOD_REQUIRED', 'Bu bütçe dönemi sona erdi. Yeni harcama kaydedilemez; geçmişteki hatalı kayıtları iptal edebilirsiniz.');
          if (calendarDaysBetween(calendarDateAt(expense.occurredAt, current.input.timeZone), current.input.nextPayday) <= 0) invalidData();
          if (current.expenses.some((row) => row.id === expense.id)) throw new BudgetStorageError('ALREADY_EXISTS', 'Bu harcama zaten kayıtlı.');
          if (current.revision !== command.expectedRevision) throw new BudgetStorageError('CONFLICT', 'Bütçe değişti. Tutarınız korunuyor; güncel bütçeyi yükleyip yeniden kontrol edin.');
          assertCalculation({ ...current.input, transactions: [...current.input.transactions, { id: expense.id, kind: 'expense', amountMinor: expense.amountMinor, occurredAt: expense.occurredAt }] });
          const revision = await advanceRevision(tx, current, command.expectedRevision);
          await tx.run('INSERT INTO budget_expenses (id, period_id, amount_minor, category, description, occurred_at, created_at, status, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [expense.id, 1, expense.amountMinor, expense.category, expense.description, expense.occurredAt, expense.createdAt, 'active', null]);
          return finish(tx, command.operationId, payload, revision, command.asOf);
        });
      });
    },
    cancelExpense(request: CancelExpenseCommand) {
      const command = { ...request };
      return serial(async () => {
        validateMutation(command.operationId, command.periodId, command.expectedRevision, command.asOf);
        identifier(command.expenseId);
        const cancelledAt = normalizeInstant(command.cancelledAt);
        if (cancelledAt > normalizeInstant(command.asOf)) invalidData();
        const payload = JSON.stringify({ kind: 'expense-cancel', periodId: command.periodId, expectedRevision: command.expectedRevision, expenseId: command.expenseId, cancelledAt });
        return database.transaction(async (tx) => {
          const current = await requireBudget(tx, command.asOf);
          const expense = current.expenses.find((row) => row.id === command.expenseId);
          if (!expense) throw new BudgetStorageError('NOT_FOUND', 'Harcama kaydı bulunamadı.');
          if (await isReplay(tx, command.operationId, payload, current)) {
            if (expense.status !== 'cancelled' || expense.cancelledAt !== cancelledAt) invalidData();
            return current;
          }
          if (expense.status === 'cancelled') throw new BudgetStorageError('ALREADY_CANCELLED', 'Bu harcama zaten iptal edilmiş.');
          if (cancelledAt < expense.createdAt) invalidData();
          const revision = await advanceRevision(tx, current, command.expectedRevision);
          const result = await tx.run("UPDATE budget_expenses SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND period_id = ? AND status = 'active'", [cancelledAt, command.expenseId, 1]);
          if (result.changes !== 1) throw new BudgetStorageError('ALREADY_CANCELLED', 'Harcama daha önce iptal edilmiş.');
          return finish(tx, command.operationId, payload, revision, command.asOf);
        });
      });
    },
  };
}
