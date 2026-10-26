import { calendarDateAt, calendarDaysBetween } from '../../domain/budget';
import { BudgetStorageError } from './errors';
import { identifier, normalizeInstant, sameExpenseData, validateExpenseData } from './expense-validation';
import { invalidData } from './guards';
import type { AddExpenseCommandV3, CancelExpenseCommandV3, SavedPeriodV3 } from './v3-contracts';
import { advancePeriodV3, checkActivationV3, readOperationV3, writeOperationV3, type AtomicV3, type OperationV3 } from './v3-operations';
import { readRecordedPeriodV3, requireActiveV3 } from './v3-records';
import { checkedBudget, conflict, publicId, validateMutationV3 } from './v3-validation';
import type { SqlSession } from './contracts';

async function recordedExpensePeriod(tx: SqlSession, operation: OperationV3, command: AddExpenseCommandV3 | CancelExpenseCommandV3): Promise<SavedPeriodV3> {
  if (operation.periodId !== command.periodId || operation.sourcePeriodId !== null) invalidData();
  const period = await readRecordedPeriodV3(tx, command, command.asOf);
  if (period.revision < operation.resultingRevision) invalidData(); return period;
}
export function expenseOperationsV3(atomic: AtomicV3) {
  return {
    async addExpense(request: AddExpenseCommandV3): Promise<SavedPeriodV3> {
      const command = { ...request, expense: { ...request.expense } };
      return atomic(async tx => {
        validateMutationV3(command); publicId(command.expensePublicId);
        const expense = validateExpenseData(command.expense, command.asOf);
        const payload = JSON.stringify({ kind: 'expense-add', commandVersion: 1, bookId: command.bookId,
          periodId: command.periodId, periodPublicId: command.periodPublicId, expectedRevision: command.expectedRevision,
          expectedActivationRevision: command.expectedActivationRevision, expensePublicId: command.expensePublicId, expense });
        const operation = await readOperationV3(tx, command.operationId, command.bookId, 'expense-add', payload);
        if (operation) {
          const saved = await recordedExpensePeriod(tx, operation, command);
          const stored = saved.expenses.find(row => row.id === expense.id);
          if (!stored || stored.publicId !== command.expensePublicId || !sameExpenseData(stored, expense)) invalidData();
          return saved;
        }
        await checkActivationV3(tx, command.bookId, command.expectedActivationRevision);
        const current = await requireActiveV3(tx, command, command.asOf);
        if (current.revision !== command.expectedRevision) conflict();
        if (current.result.requiresNewPeriod) throw new BudgetStorageError('NEW_PERIOD_REQUIRED', 'Bu döneme yeni harcama kaydedilemez. Önce yeni dönem başlatılmalıdır.');
        if (expense.occurredAt <= normalizeInstant(current.input.balanceSnapshot.capturedAt) || expense.occurredAt <= current.openedAt ||
          calendarDaysBetween(calendarDateAt(expense.occurredAt, current.input.timeZone), current.input.nextPayday) <= 0) invalidData();
        if ((await tx.all('SELECT id FROM budget_expenses WHERE id=? OR public_id=?', [expense.id, command.expensePublicId])).length) {
          throw new BudgetStorageError('ALREADY_EXISTS', 'Harcama kimliği zaten kullanılmış. Yeni kayıt oluşturulmadı.');
        }
        checkedBudget({ ...current.input, transactions: [...current.input.transactions,
          { id: expense.id, kind: 'expense', amountMinor: expense.amountMinor, occurredAt: expense.occurredAt }] });
        const revision = await advancePeriodV3(tx, command.bookId, command.periodId, command.expectedRevision);
        await tx.run(`INSERT INTO budget_expenses(id,public_id,period_id,amount_minor,category,description,occurred_at,created_at,status,cancelled_at)
          VALUES(?,?,?,?,?,?,?,?,'active',NULL)`, [expense.id, command.expensePublicId, command.periodId, expense.amountMinor,
          expense.category, expense.description, expense.occurredAt, expense.createdAt]);
        await writeOperationV3(tx, { id: command.operationId, bookId: command.bookId, periodId: command.periodId,
          sourcePeriodId: null, kind: 'expense-add', payload, resultingRevision: revision });
        return requireActiveV3(tx, command, command.asOf);
      });
    },
    async cancelExpense(request: CancelExpenseCommandV3): Promise<SavedPeriodV3> {
      const command = { ...request };
      return atomic(async tx => {
        validateMutationV3(command); identifier(command.expenseId); publicId(command.expensePublicId);
        const cancelledAt = normalizeInstant(command.cancelledAt);
        if (cancelledAt > normalizeInstant(command.asOf)) invalidData();
        const payload = JSON.stringify({ kind: 'expense-cancel', commandVersion: 1, bookId: command.bookId,
          periodId: command.periodId, periodPublicId: command.periodPublicId, expectedRevision: command.expectedRevision,
          expectedActivationRevision: command.expectedActivationRevision, expenseId: command.expenseId, expensePublicId: command.expensePublicId, cancelledAt });
        const operation = await readOperationV3(tx, command.operationId, command.bookId, 'expense-cancel', payload);
        if (operation) {
          const saved = await recordedExpensePeriod(tx, operation, command);
          const expense = saved.expenses.find(row => row.id === command.expenseId);
          if (!expense || expense.publicId !== command.expensePublicId || expense.status !== 'cancelled' || expense.cancelledAt !== cancelledAt) invalidData();
          return saved;
        }
        await checkActivationV3(tx, command.bookId, command.expectedActivationRevision);
        const current = await requireActiveV3(tx, command, command.asOf);
        if (current.revision !== command.expectedRevision) conflict();
        const expense = current.expenses.find(row => row.id === command.expenseId);
        if (!expense) throw new BudgetStorageError('NOT_FOUND', 'Harcama bu dönemde bulunamadı.');
        if (expense.publicId !== command.expensePublicId) conflict('Harcama kimliği eşleşmiyor.');
        if (expense.status === 'cancelled') throw new BudgetStorageError('ALREADY_CANCELLED', 'Harcama zaten iptal edilmiş.');
        if (cancelledAt < expense.createdAt) invalidData();
        const revision = await advancePeriodV3(tx, command.bookId, command.periodId, command.expectedRevision);
        const changed = await tx.run("UPDATE budget_expenses SET status='cancelled',cancelled_at=? WHERE id=? AND public_id=? AND period_id=? AND status='active'",
          [cancelledAt, command.expenseId, command.expensePublicId, command.periodId]);
        if (changed.changes !== 1) conflict();
        await writeOperationV3(tx, { id: command.operationId, bookId: command.bookId, periodId: command.periodId,
          sourcePeriodId: null, kind: 'expense-cancel', payload, resultingRevision: revision });
        return requireActiveV3(tx, command, command.asOf);
      });
    },
  };
}
