import type { CurrencyCode, CurrencyDefinition } from './currencies';

export type { CurrencyCode } from './currencies';

export type BalanceSnapshot = Readonly<{
  /** All monetary fields are safe integer minor units: 1 TRY = 100 kuruş. */
  amountMinor: number;
  /** Inclusive cutoff: this balance already includes transactions at or before this instant. */
  capturedAt: string;
}>;

export type ScheduledPayment = Readonly<{
  id: string;
  amountMinor: number;
  /** Gregorian local calendar date, YYYY-MM-DD. Keep settled records for reconciliation. */
  dueOn: string;
}>;

type TransactionBase = Readonly<{
  id: string;
  amountMinor: number;
  /** Actual economic occurrence, not the later data-entry time. Explicit offset required. */
  occurredAt: string;
}>;

export type BudgetTransaction = TransactionBase &
  (
    | Readonly<{ kind: 'expense' }>
    | Readonly<{ kind: 'bill-payment'; paymentId: string }>
  );

export type BudgetInput = Readonly<{
  currency: CurrencyCode;
  /** Explicit clock input; the engine never reads the system clock. */
  asOf: string;
  /** IANA zone or a named UTC alias; never inferred from the device. */
  timeZone: string;
  balanceSnapshot: BalanceSnapshot;
  nextPayday: string;
  payments: readonly ScheduledPayment[];
  savingsTargetMinor: number;
  transactions: readonly BudgetTransaction[];
}>;

export type DailyBudget = Readonly<{
  /** Equal reallocation of current positive spendable funds, including today. */
  recommendedDailyMinor: number;
  /** Reconstructed before today's post-snapshot transactions. */
  todayStartTargetMinor: number;
  /** Signed target remainder; negative means today's target has been exceeded. */
  todayRemainingMinor: number;
  /** Tomorrow onwards, after reserving the positive remainder of today's target. */
  forwardDailyAverageMinor: number | null;
  daysAfterToday: number;
  uniformRemainderMinor: number;
  forwardRemainderMinor: number;
}>;

type BudgetResultBase = Readonly<{
  currency: CurrencyCode;
  minorUnitDigits: CurrencyDefinition['minorUnitDigits'];
  timeZone: string;
  today: string;
  nextPayday: string;
  daysUntilPayday: number;
  spentSinceSnapshotMinor: number;
  todayOutflowMinor: number;
  todayBudgetImpactMinor: number;
  remainingBalanceMinor: number;
  reservedPaymentsMinor: number;
  reservedPaymentIds: readonly string[];
  savingsReservedMinor: number;
  spendableAtDayStartMinor: number;
  /** Signed; an uncovered reserve is never silently hidden. */
  spendableMinor: number;
  budgetDeficitMinor: number;
}>;

export type BudgetResult = BudgetResultBase &
  (
    | Readonly<{ periodStatus: 'active'; requiresNewPeriod: false; daily: DailyBudget }>
    | Readonly<{
        periodStatus: 'payday-today' | 'payday-passed';
        requiresNewPeriod: true;
        daily: null;
      }>
  );

export type ExpenseSimulation = Readonly<{
  expenseMinor: number;
  current: BudgetResult;
  simulated: BudgetResult;
}>;
