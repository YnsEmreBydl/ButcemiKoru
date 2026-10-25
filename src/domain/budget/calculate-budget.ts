import { checkedMinor, minimum, positivePart, requireMinor } from './money';
import type { BudgetInput, BudgetResult, DailyBudget, ExpenseSimulation } from './types';
import { validateBudget, type ValidatedBudget } from './validation';

function calculateValidated(input: ValidatedBudget, simulatedExpense = 0n): BudgetResult {
  let spent = simulatedExpense;
  let spentBeforeToday = 0n;
  let todayOutflow = simulatedExpense;
  const settledNow = new Set<string>();
  const settledAtDayStart = new Set<string>();

  for (const transaction of input.transactions) {
    const includedInSnapshot = transaction.instant <= input.snapshotInstant;
    const beforeToday = transaction.dayOrdinal < input.todayOrdinal;
    if (transaction.paymentId !== null) {
      settledNow.add(transaction.paymentId);
      if (includedInSnapshot || beforeToday) settledAtDayStart.add(transaction.paymentId);
    }
    // Historical records still reconcile bills, but never debit the snapshot a second time.
    if (includedInSnapshot) continue;
    spent += transaction.amount;
    if (beforeToday) spentBeforeToday += transaction.amount;
    else todayOutflow += transaction.amount;
  }

  let reservedNow = 0n;
  let reservedAtDayStart = 0n;
  const reservedPaymentIds: string[] = [];
  for (const payment of input.payments) {
    // Includes overdue unpaid bills; payday itself belongs to the next period.
    if (payment.dueOrdinal >= input.paydayOrdinal) continue;
    if (!settledNow.has(payment.id)) {
      reservedNow += payment.amount;
      reservedPaymentIds.push(payment.id);
    }
    if (!settledAtDayStart.has(payment.id)) reservedAtDayStart += payment.amount;
  }

  const remainingBalance = input.openingBalance - spent;
  const spendable = remainingBalance - reservedNow - input.savingsTarget;
  const atDayStart = input.openingBalance - spentBeforeToday - reservedAtDayStart - input.savingsTarget;
  const todayImpact = atDayStart - spendable;
  const daysUntilPayday = input.paydayOrdinal - input.todayOrdinal;
  const base = {
    currency: input.currency.code,
    minorUnitDigits: input.currency.minorUnitDigits,
    timeZone: input.timeZone,
    today: input.today,
    nextPayday: input.nextPayday,
    daysUntilPayday,
    spentSinceSnapshotMinor: checkedMinor(spent, 'result.spentSinceSnapshotMinor'),
    todayOutflowMinor: checkedMinor(todayOutflow, 'result.todayOutflowMinor'),
    todayBudgetImpactMinor: checkedMinor(todayImpact, 'result.todayBudgetImpactMinor'),
    remainingBalanceMinor: checkedMinor(remainingBalance, 'result.remainingBalanceMinor'),
    reservedPaymentsMinor: checkedMinor(reservedNow, 'result.reservedPaymentsMinor'),
    reservedPaymentIds: reservedPaymentIds.sort(),
    savingsReservedMinor: checkedMinor(input.savingsTarget, 'result.savingsReservedMinor'),
    spendableAtDayStartMinor: checkedMinor(atDayStart, 'result.spendableAtDayStartMinor'),
    spendableMinor: checkedMinor(spendable, 'result.spendableMinor'),
    budgetDeficitMinor: checkedMinor(positivePart(-spendable), 'result.budgetDeficitMinor'),
  };

  if (daysUntilPayday <= 0) {
    return {
      ...base,
      periodStatus: daysUntilPayday === 0 ? 'payday-today' : 'payday-passed',
      requiresNewPeriod: true,
      daily: null,
    };
  }

  const days = BigInt(daysUntilPayday);
  const available = positivePart(spendable);
  const startTarget = positivePart(atDayStart) / days;
  // A release from an already-underfunded reserve must not manufacture spendable cash.
  const todayRemaining = minimum(startTarget - todayImpact, available);
  const futureDays = daysUntilPayday - 1;
  const futurePool = available - positivePart(todayRemaining);
  const futureDivisor = BigInt(futureDays);
  const daily: DailyBudget = {
    recommendedDailyMinor: checkedMinor(available / days, 'daily.recommendedDailyMinor'),
    todayStartTargetMinor: checkedMinor(startTarget, 'daily.todayStartTargetMinor'),
    todayRemainingMinor: checkedMinor(todayRemaining, 'daily.todayRemainingMinor'),
    forwardDailyAverageMinor: futureDays > 0
      ? checkedMinor(futurePool / futureDivisor, 'daily.forwardDailyAverageMinor')
      : null,
    daysAfterToday: futureDays,
    uniformRemainderMinor: checkedMinor(available % days, 'daily.uniformRemainderMinor'),
    forwardRemainderMinor: checkedMinor(futureDays > 0 ? futurePool % futureDivisor : futurePool, 'daily.forwardRemainderMinor'),
  };
  return { ...base, periodStatus: 'active', requiresNewPeriod: false, daily };
}

export function calculateBudget(input: BudgetInput): BudgetResult {
  return calculateValidated(validateBudget(input));
}

/** Hypothetical spending now. No fabricated ledger event, mutation, or persistence. */
export function simulateExpense(input: BudgetInput, expenseMinor: number): ExpenseSimulation {
  const expense = requireMinor(expenseMinor, 'expenseMinor', 'positive');
  const validated = validateBudget(input);
  return {
    expenseMinor: checkedMinor(expense, 'expenseMinor'),
    current: calculateValidated(validated),
    simulated: calculateValidated(validated, expense),
  };
}
