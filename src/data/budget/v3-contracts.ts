import type { BudgetInput, BudgetResult } from '../../domain/budget';
import type { ExpenseData, PaymentName, SavedExpense } from './contracts';

export type BudgetBookV3 = Readonly<{ id: number; publicId: string; activationRevision: number }>;
export type PeriodScopeV3 = Readonly<{ bookId: number; periodId: number; periodPublicId: string }>;
export type MutationScopeV3 = PeriodScopeV3 & Readonly<{
  operationId: string;
  expectedRevision: number;
  expectedActivationRevision: number;
  /** Validation/read clock, excluded from the idempotency payload. */
  asOf: string;
}>;
export type PaymentV3 = Readonly<{
  id: string; publicId: string; name: string; amountMinor: number; dueOn: string;
  carriedFrom: Readonly<{ periodId: number; paymentId: string }> | null;
}>;
export type ExpenseV3 = SavedExpense & Readonly<{ publicId: string }>;
type PeriodDataV3 = Readonly<{
  id: number; publicId: string; bookId: number; previousPeriodId: number | null;
  revision: number; openedAt: string; createdAt: string | null;
  input: BudgetInput; result: BudgetResult;
  payments: readonly PaymentV3[]; expenses: readonly ExpenseV3[];
}>;
export type ActivePeriodV3 = PeriodDataV3 & Readonly<{
  status: 'active'; closedAt: null; calculationVersion: null;
}>;
export type ClosedPeriodV3 = PeriodDataV3 & Readonly<{
  status: 'closed'; closedAt: string; calculationVersion: string;
}>;
export type SavedPeriodV3 = ActivePeriodV3 | ClosedPeriodV3;

export type CarryPaymentV3 = Readonly<{
  sourcePaymentId: string; sourcePaymentPublicId: string;
  newId: string; newPublicId: string;
  /** Explicit date; no inferred recurring-bill schedule. Overdue dates are allowed. */
  dueOn: string;
}>;
export type StartPeriodCommandV3 = Readonly<{
  operationId: string; bookId: number;
  sourcePeriodId: number; sourcePeriodPublicId: string;
  expectedSourceRevision: number; expectedActivationRevision: number;
  newPeriodPublicId: string;
  /** Must be literally true; amount is the user's available balance, never inferred income. */
  availableBalanceConfirmed: true;
  availableBalanceMinor: number; balanceCapturedAt: string;
  nextPayday: string; savingsTargetMinor: number;
  carryPayments: readonly CarryPaymentV3[];
  asOf: string;
}>;
export type StartPeriodResultV3 = Readonly<{
  operationId: string; replayed: boolean;
  transitionActivationRevision: number;
  source: ClosedPeriodV3;
  /** Recorded target, which may already be closed on a much later retry. */
  target: SavedPeriodV3;
}>;

export type SaveBudgetCommandV3 = Readonly<{
  operationId: string; bookId: number; expectedActivationRevision: number;
  target: Readonly<{ kind: 'initial'; publicId: string }> |
    Readonly<{ kind: 'existing'; periodId: number; publicId: string; expectedRevision: number }>;
  /** No caller-supplied transactions: persisted expenses are supplied by the repository. */
  input: BudgetInput; paymentNames: readonly PaymentName[];
}>;
export type AddExpenseCommandV3 = MutationScopeV3 & Readonly<{ expensePublicId: string; expense: ExpenseData }>;
export type CancelExpenseCommandV3 = MutationScopeV3 & Readonly<{
  expenseId: string; expensePublicId: string; cancelledAt: string;
}>;

export interface BudgetRepositoryV3 {
  loadBook(bookId: number): Promise<BudgetBookV3>;
  loadActivePeriod(bookId: number, asOf: string): Promise<ActivePeriodV3 | null>;
  loadClosedPeriod(scope: PeriodScopeV3): Promise<ClosedPeriodV3>;
  listClosedPeriods(bookId: number): Promise<readonly ClosedPeriodV3[]>;
  newPublicId(): Promise<string>;
  saveBudget(command: SaveBudgetCommandV3): Promise<SavedPeriodV3>;
  startPeriod(command: StartPeriodCommandV3): Promise<StartPeriodResultV3>;
  addExpense(command: AddExpenseCommandV3): Promise<SavedPeriodV3>;
  cancelExpense(command: CancelExpenseCommandV3): Promise<SavedPeriodV3>;
}
