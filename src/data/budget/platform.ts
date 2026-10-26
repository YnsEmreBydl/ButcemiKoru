import type { BudgetRepository } from './contracts';
import { BudgetStorageError } from './errors';
import { createApplicationRuntime } from './application-runtime';

/** Web/SSR fallback. No in-memory substitute masquerades as persistent storage. */
export async function getBudgetRepository(): Promise<BudgetRepository> {
  throw new BudgetStorageError('UNSUPPORTED', 'Bu sürümde kalıcı bütçe kaydı yalnızca iOS ve Android uygulamasında destekleniyor. Web ön izlemesi kayıt yapmaz.');
}

const application = createApplicationRuntime({ allowV3: false, now: () => new Date().toISOString(), store: async () => {
  throw new BudgetStorageError('UNSUPPORTED', 'Kalıcı yerel kayıt web üzerinde bu sürümde desteklenmiyor.');
} });
export function getApplicationRepository() { return application; }
