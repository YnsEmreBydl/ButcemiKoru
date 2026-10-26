import type { SavedBudget } from '../../data/budget/contracts';
import { BudgetStorageError, storageErrorMessage } from '../../data/budget/errors';

export type BudgetLoadState<T extends SavedBudget = SavedBudget> =
  | { status: 'loading' }
  | { status: 'ready'; saved: T | null; refreshing?: boolean; message?: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

/** A failed open is never interpreted as an empty database. There is no reset action. */
export function budgetLoadFailure<T extends SavedBudget>(current: BudgetLoadState<T>, error: unknown): BudgetLoadState<T> {
  const protectedFailure = error instanceof BudgetStorageError && ['MIGRATION', 'INVALID_DATA'].includes(error.code);
  const message = protectedFailure
    ? 'Yerel kayıt doğrulanamadığı için açılış durduruldu. Kayıtlarınız silinmedi veya sıfırlanmadı. Yeniden deneyebilirsiniz; sorun sürerse inceleme gerekiyor.'
    : storageErrorMessage(error);
  if (current.status === 'ready') return { ...current, refreshing: false, message };
  return { status: error instanceof BudgetStorageError && error.code === 'UNSUPPORTED' ? 'unsupported' : 'error', message };
}

export function shouldOpenSetup(state: BudgetLoadState): boolean {
  return state.status === 'ready' && state.saved === null;
}
