import type { BudgetInput, BudgetResult } from '../../domain/budget';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;
export interface SqlSession {
  exec(sql: string): Promise<void>;
  run(sql: string, parameters: readonly SqlValue[]): Promise<{ changes: number }>;
  all(sql: string, parameters?: readonly SqlValue[]): Promise<SqlRow[]>;
}
export interface AtomicDatabase {
  transaction<T>(task: (session: SqlSession) => Promise<T>): Promise<T>;
}
export type PaymentName = Readonly<{ id: string; name: string }>;
export const expenseCategories = ['market', 'food', 'transport', 'shopping', 'entertainment', 'other'] as const;
export type ExpenseCategory = typeof expenseCategories[number];
export type ExpenseData = Readonly<{
  id: string;
  amountMinor: number;
  category: ExpenseCategory;
  description: string;
  occurredAt: string;
  createdAt: string;
}>;
export type SavedExpense = ExpenseData & Readonly<{
  periodId: number;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
}>;
export type AddExpenseCommand = Readonly<{
  operationId: string;
  expectedRevision: number;
  periodId: number;
  asOf: string;
  expense: ExpenseData;
}>;
export type CancelExpenseCommand = Readonly<{
  operationId: string;
  expectedRevision: number;
  periodId: number;
  expenseId: string;
  cancelledAt: string;
  asOf: string;
}>;
export type SavedBudget = Readonly<{
  revision: number;
  input: BudgetInput;
  paymentNames: readonly PaymentName[];
  result: BudgetResult;
  expenses: readonly SavedExpense[];
}>;
export type SaveBudgetCommand = Readonly<{
  operationId: string;
  expectedRevision: number | null;
  input: BudgetInput;
  paymentNames: readonly PaymentName[];
}>;
export interface BudgetRepository {
  load(asOf: string): Promise<SavedBudget | null>;
  save(command: SaveBudgetCommand): Promise<SavedBudget>;
  newOperationId(): Promise<string>;
  addExpense(command: AddExpenseCommand): Promise<SavedBudget>;
  cancelExpense(command: CancelExpenseCommand): Promise<SavedBudget>;
}
