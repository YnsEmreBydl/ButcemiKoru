import { calendarDateAt, calendarDaysBetween, type BudgetInput } from '../../domain/budget';
import type { SqlRow, SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { isExpenseCategory, normalizeInstant, validateExpenseData } from './expense-validation';
import { integer, invalidData, stringValue } from './guards';
import { validateNames } from './validation';
import type { ActivePeriodV3, BudgetBookV3, ExpenseV3, PaymentV3, PeriodScopeV3, SavedPeriodV3 } from './v3-contracts';
import { checkedBudget, conflict, decodeClosingResult, positiveInteger, publicId, validateScope } from './v3-validation';

export async function requireV3(tx: SqlSession): Promise<void> {
  if ((await tx.all('PRAGMA user_version'))[0]?.user_version !== 3) {
    throw new BudgetStorageError('MIGRATION', 'Bu repository yalnızca önceden hazırlanmış v3 veritabanını kullanır. Otomatik yükseltme yapılmadı.');
  }
}
export async function readBookV3(tx: SqlSession, bookId: number): Promise<BudgetBookV3> {
  positiveInteger(bookId);
  const rows = await tx.all('SELECT id, public_id, activation_revision FROM budget_books WHERE id = ?', [bookId]);
  if (!rows.length) throw new BudgetStorageError('NOT_FOUND', 'Bütçe defteri bulunamadı.');
  const row = rows[0], revision = integer(row.activation_revision);
  if (rows.length !== 1 || revision < 0 || positiveInteger(row.id) !== bookId) invalidData();
  return { id: bookId, publicId: publicId(row.public_id), activationRevision: revision };
}

function decodeExpenseV3(row: SqlRow, periodId: number, asOf: string): ExpenseV3 {
  if (positiveInteger(row.period_id) !== periodId || !isExpenseCategory(row.category) || typeof row.description !== 'string') invalidData();
  const expense = validateExpenseData({ id: stringValue(row.id), amountMinor: integer(row.amount_minor),
    category: row.category, description: row.description, occurredAt: stringValue(row.occurred_at), createdAt: stringValue(row.created_at) }, asOf);
  if (expense.occurredAt !== row.occurred_at || expense.createdAt !== row.created_at) invalidData();
  if (row.status !== 'active' && row.status !== 'cancelled') invalidData();
  const cancelledAt = row.cancelled_at === null ? null : normalizeInstant(row.cancelled_at);
  if ((row.status === 'active' && cancelledAt !== null) ||
    (row.status === 'cancelled' && (cancelledAt === null || cancelledAt !== row.cancelled_at ||
      cancelledAt < expense.createdAt || cancelledAt > normalizeInstant(asOf)))) invalidData();
  return { ...expense, publicId: publicId(row.public_id), periodId, status: row.status, cancelledAt };
}
function decodePaymentV3(row: SqlRow, periodId: number): PaymentV3 {
  if (positiveInteger(row.period_id) !== periodId) invalidData();
  const amount = positiveInteger(row.amount_minor);
  const hasSource = row.carried_from_period_id !== null;
  if (hasSource !== (row.carried_from_payment_id !== null)) invalidData();
  return { id: stringValue(row.id), publicId: publicId(row.public_id), name: stringValue(row.name),
    amountMinor: amount, dueOn: stringValue(row.due_on), carriedFrom: hasSource ? {
      periodId: positiveInteger(row.carried_from_period_id), paymentId: stringValue(row.carried_from_payment_id),
    } : null };
}

/** Only the requested period's invoices and expenses are read. Closed periods use their frozen clock. */
export async function readPeriodV3(tx: SqlSession, scope: PeriodScopeV3, asOf?: string): Promise<SavedPeriodV3> {
  validateScope(scope); await readBookV3(tx, scope.bookId);
  const rows = await tx.all('SELECT * FROM budget_periods WHERE id = ? AND book_id = ?', [scope.periodId, scope.bookId]);
  if (!rows.length) throw new BudgetStorageError('NOT_FOUND', 'İstenen bütçe dönemi bulunamadı.');
  const row = rows[0]; if (rows.length !== 1 || positiveInteger(row.id) !== scope.periodId) invalidData();
  if (publicId(row.public_id) !== scope.periodPublicId) conflict('Dönem kimliği eşleşmiyor. Kayıt güncellenmedi.');
  if (row.status !== 'active' && row.status !== 'closed') invalidData();
  const clock = row.status === 'closed' ? normalizeInstant(row.closed_at) :
    typeof asOf === 'string' ? normalizeInstant(asOf) : conflict('İstenen dönem henüz kapalı bir arşiv değil.');
  const openedAt = normalizeInstant(row.opened_at), createdAt = row.created_at === null ? null : normalizeInstant(row.created_at);
  if (openedAt !== row.opened_at || openedAt > clock || (createdAt !== null && (createdAt !== row.created_at || createdAt < openedAt || createdAt > clock))) invalidData();
  const previousPeriodId = row.previous_period_id === null ? null : positiveInteger(row.previous_period_id);
  if (previousPeriodId !== null) {
    const previous = await tx.all("SELECT id FROM budget_periods WHERE id = ? AND book_id = ? AND status = 'closed' AND closed_at = ?", [previousPeriodId, scope.bookId, openedAt]);
    if (previous.length !== 1 || previousPeriodId === scope.periodId) invalidData();
  }
  const paymentRows = await tx.all('SELECT * FROM budget_payments WHERE period_id = ? ORDER BY id', [scope.periodId]);
  const payments = paymentRows.map(payment => decodePaymentV3(payment, scope.periodId));
  for (const payment of payments) {
    if (payment.carriedFrom !== null) {
      if (payment.carriedFrom.periodId !== previousPeriodId) invalidData();
      const source = await tx.all('SELECT id FROM budget_payments WHERE period_id = ? AND id = ?', [payment.carriedFrom.periodId, payment.carriedFrom.paymentId]);
      if (source.length !== 1) invalidData();
    }
  }
  const expenses = (await tx.all('SELECT * FROM budget_expenses WHERE period_id = ? ORDER BY occurred_at DESC, created_at DESC, id DESC', [scope.periodId]))
    .map(expense => decodeExpenseV3(expense, scope.periodId, clock));
  if (row.currency !== 'TRY') invalidData();
  const input: BudgetInput = { currency: 'TRY', timeZone: stringValue(row.time_zone), asOf: clock,
    balanceSnapshot: { amountMinor: integer(row.balance_minor), capturedAt: stringValue(row.balance_captured_at) },
    nextPayday: stringValue(row.next_payday), savingsTargetMinor: integer(row.savings_minor),
    payments: payments.map(payment => ({ id: payment.id, amountMinor: payment.amountMinor, dueOn: payment.dueOn })),
    transactions: expenses.filter(expense => expense.status === 'active').map(expense => ({ id: expense.id, kind: 'expense', amountMinor: expense.amountMinor, occurredAt: expense.occurredAt })),
  };
  if (normalizeInstant(input.balanceSnapshot.capturedAt) < openedAt) invalidData();
  const result = checkedBudget(input);
  validateNames(payments.map(payment => ({ id: payment.id, name: payment.name })), input);
  for (const expense of expenses) {
    if (calendarDaysBetween(calendarDateAt(expense.occurredAt, input.timeZone), input.nextPayday) <= 0) invalidData();
  }
  const shared = { id: scope.periodId, publicId: scope.periodPublicId, bookId: scope.bookId, previousPeriodId,
    revision: positiveInteger(row.revision), openedAt, createdAt, input, payments, expenses };
  if (row.status === 'closed') {
    if (clock !== row.closed_at) invalidData();
    return { ...shared, status: 'closed', closedAt: clock, calculationVersion: stringValue(row.calculation_version),
      result: decodeClosingResult(row.closing_result_json, row.calculation_version, result) };
  }
  if (row.closed_at !== null || row.calculation_version !== null || row.closing_result_json !== null) invalidData();
  return { ...shared, status: 'active', closedAt: null, calculationVersion: null, result };
}

export async function readActiveV3(tx: SqlSession, bookId: number, asOf: string): Promise<ActivePeriodV3 | null> {
  await readBookV3(tx, bookId); normalizeInstant(asOf);
  const rows = await tx.all("SELECT id, public_id FROM budget_periods WHERE book_id = ? AND status = 'active'", [bookId]);
  if (rows.length > 1) invalidData();
  if (!rows.length) return null;
  const period = await readPeriodV3(tx, { bookId, periodId: positiveInteger(rows[0].id), periodPublicId: publicId(rows[0].public_id) }, asOf);
  if (period.status !== 'active') invalidData(); return period;
}

export async function requireActiveV3(tx: SqlSession, scope: PeriodScopeV3, asOf: string): Promise<ActivePeriodV3> {
  const period = await readPeriodV3(tx, scope, asOf);
  if (period.status !== 'active') conflict('Bu formun bütçe dönemi kapandı. İstek yeni döneme aktarılmadı.');
  const active = await readActiveV3(tx, scope.bookId, asOf);
  if (!active || active.id !== scope.periodId) conflict(); return period;
}

/** An old acknowledgement clock cannot hide movements committed after the original command. */
export async function readRecordedPeriodV3(tx: SqlSession, scope: PeriodScopeV3, asOf: string): Promise<SavedPeriodV3> {
  const rows = await tx.all('SELECT status,balance_captured_at,created_at FROM budget_periods WHERE id=? AND book_id=?', [scope.periodId, scope.bookId]);
  if (rows[0]?.status === 'closed') return readPeriodV3(tx, scope);
  const times = [normalizeInstant(asOf)];
  if (rows.length) {
    times.push(normalizeInstant(rows[0].balance_captured_at));
    if (rows[0].created_at !== null) times.push(normalizeInstant(rows[0].created_at));
  }
  const latest = await tx.all('SELECT max(created_at) AS created_at,max(cancelled_at) AS cancelled_at FROM budget_expenses WHERE period_id=?', [scope.periodId]);
  for (const instant of [latest[0]?.created_at, latest[0]?.cancelled_at]) if (instant !== null && instant !== undefined) times.push(normalizeInstant(instant));
  return readPeriodV3(tx, scope, times.reduce((a, b) => a > b ? a : b));
}
