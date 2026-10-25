import { calculateBudget } from '../../domain/budget';
import type { AddExpenseCommand, ExpenseCategory, SavedBudget } from '../../data/budget/contracts';
import { storageErrorMessage } from '../../data/budget/errors';
import { assertCalculation, isExpenseCategory, validateExpenseData } from '../../data/budget/expense-validation';
import { parseTurkishMoney } from '../budget-setup/input';

export const categoryLabels: Record<ExpenseCategory, string> = {
  market: 'Market', food: 'Yemek', transport: 'Ulaşım', shopping: 'Alışveriş',
  entertainment: 'Eğlence', other: 'Diğer',
};
export type ExpenseDraft = Readonly<{ amount: string; category: ExpenseCategory; description: string }>;
export type ExpenseErrors = { amount?: string; description?: string; general?: string };
export type ExpenseContext = Readonly<{ operationId: string; occurredAt: string; createdAt: string; asOf: string }>;
export type ExpensePreparation =
  | { status: 'invalid'; errors: ExpenseErrors }
  | { status: 'ready'; command: AddExpenseCommand };

export function prepareExpense(draft: ExpenseDraft, saved: SavedBudget, context: ExpenseContext): ExpensePreparation {
  const errors: ExpenseErrors = {};
  const amount = parseTurkishMoney(draft.amount);
  if (!amount.ok) errors.amount = amount.message;
  else if (amount.value <= 0) errors.amount = 'Harcama tutarı sıfırdan büyük olmalıdır.';
  if (!isExpenseCategory(draft.category)) errors.general = 'Geçerli bir kategori seçin.';
  const description = draft.description.trim();
  if (description.length > 200) errors.description = 'Açıklama en fazla 200 karakter olabilir.';
  if (!amount.ok || errors.amount || errors.description || errors.general) return { status: 'invalid', errors };
  try {
    const current = calculateBudget({ ...saved.input, asOf: context.asOf });
    if (current.requiresNewPeriod) return { status: 'invalid', errors: { general: 'Bu dönem sona erdi. Yeni harcama kaydedilemez; geçmiş kayıtlar iptal edilebilir.' } };
    const expense = validateExpenseData({
      id: context.operationId, amountMinor: amount.value, category: draft.category, description,
      occurredAt: context.occurredAt, createdAt: context.createdAt,
    }, context.asOf);
    assertCalculation({ ...saved.input, asOf: context.asOf, transactions: [...saved.input.transactions, {
      id: expense.id, kind: 'expense', amountMinor: expense.amountMinor, occurredAt: expense.occurredAt,
    }] });
    return { status: 'ready', command: { operationId: context.operationId, periodId: 1, expectedRevision: saved.revision, asOf: context.asOf, expense } };
  } catch (error) { return { status: 'invalid', errors: { general: storageErrorMessage(error) } }; }
}

/** Resolve an uncertain acknowledgement by reading, never by inventing a new expense. */
export function reconcileExpenseAttempt(command: AddExpenseCommand, saved: SavedBudget | null): 'saved' | 'missing' | 'conflict' {
  const row = saved?.expenses.find((expense) => expense.id === command.expense.id);
  if (!row) return 'missing';
  const expected = command.expense;
  return row.periodId === command.periodId && row.amountMinor === expected.amountMinor &&
    row.category === expected.category && row.description === expected.description &&
    row.occurredAt === expected.occurredAt && row.createdAt === expected.createdAt ? 'saved' : 'conflict';
}

export function formatExpenseTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(instant));
}
