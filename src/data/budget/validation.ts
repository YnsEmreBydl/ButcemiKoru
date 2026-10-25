import { calculateBudget, calendarDateAt, calendarDaysBetween, type BudgetInput } from '../../domain/budget';

import type { PaymentName, SavedBudget, SaveBudgetCommand, SqlRow } from './contracts';
import { decodeExpense } from './expense-validation';
import { integer, invalidData, stringValue } from './guards';

export { integer, invalidData, stringValue } from './guards';
export function validateNames(names: readonly PaymentName[], input: BudgetInput): void {
  if (names.length !== input.payments.length) invalidData();
  const ids = new Set<string>();
  for (const row of names) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (name.length > 80 || ids.has(id) || !input.payments.some((payment) => payment.id === id)) invalidData();
    ids.add(id);
  }
}
export function validateInput(input: BudgetInput): ReturnType<typeof calculateBudget> {
  try {
    const result = calculateBudget(input);
    for (const payment of input.payments) {
      if (calendarDaysBetween(payment.dueOn, input.nextPayday) <= 0) invalidData();
    }
    return result;
  } catch {
    return invalidData();
  }
}
export function validateCommand(command: SaveBudgetCommand): { payload: string; requiresNewPeriod: boolean } {
  const id = stringValue(command.operationId);
  if (id.length > 128) invalidData();
  if (command.expectedRevision !== null && integer(command.expectedRevision) < 1) invalidData();
  const result = validateInput(command.input);
  // Only the repository may supply persisted movements; a setup form cannot invent them.
  if (command.input.transactions.length !== 0) invalidData();
  validateNames(command.paymentNames, command.input);
  const names = new Map(command.paymentNames.map((row) => [row.id, row.name]));
  // asOf is a read/validation clock, not part of the persistent payload.
  const payload = JSON.stringify({
    expectedRevision: command.expectedRevision,
    currency: command.input.currency,
    timeZone: command.input.timeZone,
    balanceSnapshot: { amountMinor: command.input.balanceSnapshot.amountMinor, capturedAt: command.input.balanceSnapshot.capturedAt },
    nextPayday: command.input.nextPayday,
    savingsTargetMinor: command.input.savingsTargetMinor,
    payments: [...command.input.payments].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((row) => ({ id: row.id, amountMinor: row.amountMinor, dueOn: row.dueOn, name: names.get(row.id) })),
  });
  return { payload, requiresNewPeriod: result.requiresNewPeriod };
}

export function decodeBudget(period: SqlRow, payments: SqlRow[], asOf: string, expenseRows: SqlRow[] = []): SavedBudget {
  if (integer(period.id) !== 1 || period.currency !== 'TRY') invalidData();
  const revision = integer(period.revision);
  if (revision < 1) invalidData();
  const names: PaymentName[] = payments.map((row) => {
    if (integer(row.period_id) !== 1) invalidData();
    return { id: stringValue(row.id), name: stringValue(row.name) };
  });
  const expenses = expenseRows.map((row) => decodeExpense(row, asOf));
  const ids = new Set<string>();
  for (const expense of expenses) {
    if (ids.has(expense.id)) invalidData();
    ids.add(expense.id);
  }
  const input: BudgetInput = {
    currency: 'TRY',
    asOf,
    timeZone: stringValue(period.time_zone),
    balanceSnapshot: { amountMinor: integer(period.balance_minor), capturedAt: stringValue(period.balance_captured_at) },
    nextPayday: stringValue(period.next_payday),
    savingsTargetMinor: integer(period.savings_minor),
    payments: payments.map((row) => ({ id: stringValue(row.id), amountMinor: integer(row.amount_minor), dueOn: stringValue(row.due_on) })),
    transactions: expenses.filter((row) => row.status === 'active').map((row) => ({
      id: row.id, kind: 'expense', amountMinor: row.amountMinor, occurredAt: row.occurredAt,
    })),
  };
  const result = validateInput(input);
  for (const expense of expenses) {
    if (calendarDaysBetween(calendarDateAt(expense.occurredAt, input.timeZone), input.nextPayday) <= 0) invalidData();
  }
  validateNames(names, input);
  return { revision, input, paymentNames: names, result, expenses };
}
