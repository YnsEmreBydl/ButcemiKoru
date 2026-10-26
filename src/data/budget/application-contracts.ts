import type { AddExpenseCommand, AtomicDatabase, BudgetRepository, CancelExpenseCommand, SavedBudget, SaveBudgetCommand } from './contracts';
import type { BudgetRepositoryV3 } from './v3-contracts';
import type { PreparationConnection, PreparationFiles } from './upgrade-preparation';

export type BudgetAccess = Readonly<{ epoch: number; schema: 2 | 3; bookId: number; activationRevision: number;
  period: Readonly<{ id: number; publicId: string; revision: number }> | null }>;
export type ApplicationBudget = SavedBudget & Readonly<{ access: BudgetAccess; expensePublicIds: Readonly<Record<string, string>> }>;
export type BudgetSession = Readonly<{ access: BudgetAccess; saved: ApplicationBudget | null }>;
export type ApplicationState = Readonly<{ phase: 'idle' | 'opening' | 'upgrading' | 'recovering' | 'ready' | 'blocked'; schema: 2 | 3 | null; message: string; hasOpened: boolean }>;
export type ScopedSave = SaveBudgetCommand & Readonly<{ access?: BudgetAccess }>;
export type ScopedExpense = AddExpenseCommand & Readonly<{ access?: BudgetAccess }>;
export type ScopedCancel = CancelExpenseCommand & Readonly<{ access?: BudgetAccess; expensePublicId?: string }>;
export type ApplicationPeriodPort = Pick<BudgetRepositoryV3, 'loadBook' | 'loadActivePeriod' | 'loadClosedPeriod' | 'listClosedPeriods' | 'newPublicId' | 'startPeriod'>;
export interface ApplicationRepository extends BudgetRepository {
  initialize(): Promise<void>;
  open(asOf: string): Promise<BudgetSession>;
  load(asOf: string): Promise<ApplicationBudget | null>;
  save(command: ScopedSave): Promise<ApplicationBudget>;
  addExpense(command: ScopedExpense): Promise<ApplicationBudget>;
  cancelExpense(command: ScopedCancel): Promise<ApplicationBudget>;
  periods(): Promise<ApplicationPeriodPort>;
  getSnapshot(): ApplicationState;
  subscribe(listener: () => void): () => void;
}
export interface RuntimeStore extends PreparationFiles {
  catalog: AtomicDatabase;
  source: PreparationConnection;
  close(): Promise<void>;
}
