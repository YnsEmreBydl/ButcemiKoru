import { storageErrorMessage } from '../../data/budget/errors';
import type { PeriodScopeV3 } from '../../data/budget/v3-contracts';
import { type PeriodPort, periodScopeKey } from './contracts';
import { createPeriodFormController } from './form-controller';
import { createResource } from './resource';

/** Registry outlives individual routes: back/remount retains drafts and unresolved commands. */
export function createPeriodWorkspace(port: PeriodPort, now: () => string, bookId: number, mode: 'demo' | 'saved' = 'demo') {
  const active = createResource(async () => {
    const [book, period] = await Promise.all([port.loadBook(bookId), port.loadActivePeriod(bookId, now())]);
    return { book, period };
  }, storageErrorMessage);
  const history = createResource(() => port.listClosedPeriods(bookId), storageErrorMessage);
  const forms = new Map<string, ReturnType<typeof createPeriodFormController>>();
  const archives = new Map<string, ReturnType<typeof archive>>();
  function archive(scope: PeriodScopeV3) {
    const captured = { ...scope };
    return createResource(() => port.loadClosedPeriod(captured), storageErrorMessage);
  }
  return { bookId, now, active, history,
    form(scope: PeriodScopeV3) {
      const key = periodScopeKey(scope), stored = forms.get(key); if (stored) return stored;
      const controller = createPeriodFormController(port, scope, now, () => { void active.refresh(); void history.refresh(); }, mode);
      forms.set(key, controller); return controller;
    },
    archive(scope: PeriodScopeV3) {
      const key = periodScopeKey(scope), stored = archives.get(key); if (stored) return stored;
      const resource = archive(scope); archives.set(key, resource); return resource;
    },
  };
}
