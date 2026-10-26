import { BudgetInputError, calculateBudget, calendarDateAt, type BudgetInput } from '../../domain/budget';

import { expenseCategories, type ExpenseCategory, type ExpenseData, type SavedExpense, type SqlRow } from './contracts';
import { BudgetStorageError } from './errors';
import { integer, invalidData, stringValue } from './guards';

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return expenseCategories.some((category) => category === value);
}

export function identifier(value: unknown): string {
  const id = stringValue(value);
  if (id.length > 128) invalidData();
  return id;
}

/** Reuse domain instant validation, then store one sortable UTC representation. */
export function normalizeInstant(value: unknown): string {
  const text = stringValue(value);
  try {
    calendarDateAt(text, 'UTC');
    return new Date(text).toISOString();
  } catch { return invalidData(); }
}

export function validateExpenseData(value: ExpenseData, asOf: string): ExpenseData {
  const id = identifier(value.id);
  const amountMinor = integer(value.amountMinor);
  if (amountMinor <= 0 || !isExpenseCategory(value.category)) invalidData();
  if (typeof value.description !== 'string' || value.description.trim() !== value.description || value.description.length > 200) invalidData();
  const occurredAt = normalizeInstant(value.occurredAt);
  const createdAt = normalizeInstant(value.createdAt);
  const clock = normalizeInstant(asOf);
  if (occurredAt > createdAt || createdAt > clock) invalidData();
  return { id, amountMinor, category: value.category, description: value.description, occurredAt, createdAt };
}

export function sameExpenseData(left: ExpenseData, right: ExpenseData): boolean {
  return left.id === right.id && left.amountMinor === right.amountMinor && left.category === right.category &&
    left.description === right.description && left.occurredAt === right.occurredAt && left.createdAt === right.createdAt;
}

export function decodeExpense(row: SqlRow, asOf: string): SavedExpense {
  if (integer(row.period_id) !== 1 || !isExpenseCategory(row.category) || typeof row.description !== 'string') invalidData();
  const expense = validateExpenseData({
    id: stringValue(row.id), amountMinor: integer(row.amount_minor), category: row.category,
    description: row.description, occurredAt: stringValue(row.occurred_at), createdAt: stringValue(row.created_at),
  }, asOf);
  // Stored instants must already be canonical; do not repair corrupt rows silently.
  if (expense.occurredAt !== row.occurred_at || expense.createdAt !== row.created_at) invalidData();
  if (row.status !== 'active' && row.status !== 'cancelled') invalidData();
  let cancelledAt: string | null = null;
  if (row.status === 'active') {
    if (row.cancelled_at !== null) invalidData();
  } else {
    cancelledAt = normalizeInstant(row.cancelled_at);
    if (cancelledAt !== row.cancelled_at || cancelledAt < expense.createdAt || cancelledAt > normalizeInstant(asOf)) invalidData();
  }
  return { ...expense, periodId: 1, status: row.status, cancelledAt };
}

export function validateMutation(operationId: string, periodId: number, revision: number, asOf: string): void {
  identifier(operationId);
  if (integer(periodId) !== 1 || integer(revision) < 1) invalidData();
  normalizeInstant(asOf);
}

export function assertCalculation(input: BudgetInput): void {
  try { calculateBudget(input); }
  catch (error) {
    if (error instanceof BudgetInputError && error.code === 'AMOUNT_OVERFLOW') {
      throw new BudgetStorageError('AMOUNT_OVERFLOW', 'Bu tutarla hesaplanan toplam desteklenen kuruş sınırını aşıyor. Kayıt yapılmadı.');
    }
    return invalidData();
  }
}
