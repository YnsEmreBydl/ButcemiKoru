import type { BudgetRepository } from './contracts';
import { BudgetStorageError } from './errors';

/** Web/SSR fallback. No in-memory substitute masquerades as persistent storage. */
export async function getBudgetRepository(): Promise<BudgetRepository> {
  throw new BudgetStorageError('UNSUPPORTED', 'Bu sürümde kalıcı bütçe kaydı yalnızca iOS ve Android uygulamasında destekleniyor. Web ön izlemesi kayıt yapmaz.');
}
