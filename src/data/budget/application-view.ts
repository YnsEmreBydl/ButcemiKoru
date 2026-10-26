import type { SavedBudget } from './contracts';
import { BudgetStorageError } from './errors';
import type { ApplicationBudget, BudgetAccess } from './application-contracts';
import type { BudgetBookV3, SavedPeriodV3 } from './v3-contracts';

export function captureAccess(access: BudgetAccess | undefined): BudgetAccess | undefined {
  return access ? { ...access, period: access.period ? { ...access.period } : null } : undefined;
}
export function sameBudgetPeriod(left: BudgetAccess, right: BudgetAccess): boolean {
  return left.schema === right.schema && left.epoch === right.epoch && left.bookId === right.bookId &&
    left.period?.id === right.period?.id && left.period?.publicId === right.period?.publicId;
}
export function v2View(saved: SavedBudget | null, epoch: number): { access: BudgetAccess; saved: ApplicationBudget | null } {
  const access: BudgetAccess = { schema: 2, epoch, bookId: 1, activationRevision: 0,
    period: saved ? { id: 1, publicId: '', revision: saved.revision } : null };
  return { access, saved: saved ? { ...saved, access, expensePublicIds: {} } : null };
}
export function v3View(period: SavedPeriodV3 | null, book: BudgetBookV3, epoch: number): { access: BudgetAccess; saved: ApplicationBudget | null } {
  if (period?.status === 'closed') throw new BudgetStorageError('CONFLICT', 'Bu işlemin dönemi kapandı. Kayıt korundu; güncel aktif dönemi açın.');
  const access: BudgetAccess = { schema: 3, epoch, bookId: book.id, activationRevision: book.activationRevision,
    period: period ? { id: period.id, publicId: period.publicId, revision: period.revision } : null };
  return { access, saved: period ? { revision: period.revision, input: period.input, result: period.result,
    paymentNames: period.payments.map(row => ({ id: row.id, name: row.name })), expenses: period.expenses,
    expensePublicIds: Object.fromEntries(period.expenses.map(row => [row.id, row.publicId])), access } : null };
}
