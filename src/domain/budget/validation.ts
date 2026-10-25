import { calendarFormatter, dateAt, parseCalendarDate, parseInstant } from './calendar';
import { resolveCurrency, type CurrencyDefinition } from './currencies';
import { BudgetInputError } from './errors';
import { requireMinor } from './money';

type ValidatedPayment = Readonly<{ id: string; amount: bigint; dueOrdinal: number }>;
type ValidatedTransaction = Readonly<{
  amount: bigint;
  instant: number;
  dayOrdinal: number;
  paymentId: string | null;
}>;

export type ValidatedBudget = Readonly<{
  currency: CurrencyDefinition;
  timeZone: string;
  today: string;
  todayOrdinal: number;
  snapshotInstant: number;
  nextPayday: string;
  paydayOrdinal: number;
  openingBalance: bigint;
  savingsTarget: bigint;
  payments: readonly ValidatedPayment[];
  transactions: readonly ValidatedTransaction[];
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BudgetInputError('INVALID_INPUT', field, 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BudgetInputError('INVALID_INPUT', field, 'Expected an array.');
  }
  return value;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new BudgetInputError('INVALID_INPUT', field, 'Expected a nonempty, trimmed identifier.');
  }
  return value;
}

function uniqueId(value: unknown, field: string, seen: Set<string>): string {
  const id = identifier(value, field);
  if (seen.has(id)) {
    throw new BudgetInputError('DUPLICATE_ID', field, 'Duplicate identifier.');
  }
  seen.add(id);
  return id;
}

export function validateBudget(value: unknown): ValidatedBudget {
  const input = record(value, 'input');
  const currency = resolveCurrency(input.currency);
  const formatter = calendarFormatter(input.timeZone);
  const asOf = parseInstant(input.asOf, 'asOf');
  const today = dateAt(asOf, formatter);
  const snapshot = record(input.balanceSnapshot, 'balanceSnapshot');
  const openingBalance = requireMinor(snapshot.amountMinor, 'balanceSnapshot.amountMinor', 'signed');
  const snapshotInstant = parseInstant(snapshot.capturedAt, 'balanceSnapshot.capturedAt');
  if (snapshotInstant > asOf) {
    throw new BudgetInputError('INVALID_CHRONOLOGY', 'balanceSnapshot.capturedAt', 'The balance snapshot cannot be in the future.');
  }
  dateAt(snapshotInstant, formatter);
  const payday = parseCalendarDate(input.nextPayday, 'nextPayday');
  const savingsTarget = requireMinor(input.savingsTargetMinor, 'savingsTargetMinor', 'nonnegative');
  const paymentIds = new Set<string>();
  const payments: ValidatedPayment[] = [];

  for (const [index, entry] of list(input.payments, 'payments').entries()) {
    const path = `payments[${index}]`;
    const payment = record(entry, path);
    payments.push({
      id: uniqueId(payment.id, `${path}.id`, paymentIds),
      amount: requireMinor(payment.amountMinor, `${path}.amountMinor`, 'positive'),
      dueOrdinal: parseCalendarDate(payment.dueOn, `${path}.dueOn`).ordinal,
    });
  }

  const transactionIds = new Set<string>();
  const settledPaymentIds = new Set<string>();
  const transactions: ValidatedTransaction[] = [];

  for (const [index, entry] of list(input.transactions, 'transactions').entries()) {
    const path = `transactions[${index}]`;
    const transaction = record(entry, path);
    uniqueId(transaction.id, `${path}.id`, transactionIds);
    const amount = requireMinor(transaction.amountMinor, `${path}.amountMinor`, 'positive');
    const instant = parseInstant(transaction.occurredAt, `${path}.occurredAt`);
    if (instant > asOf) {
      throw new BudgetInputError('INVALID_CHRONOLOGY', `${path}.occurredAt`, 'An actual transaction cannot be in the future.');
    }
    let paymentId: string | null = null;
    if (transaction.kind === 'bill-payment') {
      paymentId = identifier(transaction.paymentId, `${path}.paymentId`);
      if (!paymentIds.has(paymentId)) {
        throw new BudgetInputError('UNKNOWN_PAYMENT', `${path}.paymentId`, 'Referenced payment does not exist.');
      }
      if (settledPaymentIds.has(paymentId)) {
        throw new BudgetInputError('DUPLICATE_PAYMENT', `${path}.paymentId`, 'A bill may only be settled once.');
      }
      settledPaymentIds.add(paymentId);
    } else if (transaction.kind !== 'expense' || transaction.paymentId !== undefined) {
      throw new BudgetInputError('INVALID_INPUT', `${path}.kind`, 'Expected expense, or bill-payment with a paymentId.');
    }
    transactions.push({ amount, instant, dayOrdinal: dateAt(instant, formatter).ordinal, paymentId });
  }

  return {
    currency,
    timeZone: formatter.resolvedOptions().timeZone,
    today: today.value,
    todayOrdinal: today.ordinal,
    snapshotInstant,
    nextPayday: payday.value,
    paydayOrdinal: payday.ordinal,
    openingBalance,
    savingsTarget,
    payments,
    transactions,
  };
}
