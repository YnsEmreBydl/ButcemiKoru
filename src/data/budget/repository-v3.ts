import type { AtomicDatabase } from './contracts';
import { invalidData } from './guards';
import type { BudgetRepositoryV3 } from './v3-contracts';
import { expenseOperationsV3 } from './v3-expenses';
import { atomicV3 } from './v3-operations';
import { readActiveV3, readBookV3, readPeriodV3 } from './v3-records';
import { saveBudgetOperationV3 } from './v3-save';
import { startPeriodOperationV3 } from './v3-start-period';
import { publicId, validateScope } from './v3-validation';
import { listClosedPeriodsV3 } from './v3-history';

/** Stage 7B: injected, already-v3 TEST database only. No opener, filename or migration side effect. */
export function createBudgetRepositoryV3(database: AtomicDatabase): BudgetRepositoryV3 {
  const atomic = atomicV3(database);
  return {
    loadBook: bookId => atomic(tx => readBookV3(tx, bookId)),
    loadActivePeriod: (bookId, asOf) => atomic(tx => readActiveV3(tx, bookId, asOf)),
    listClosedPeriods: bookId => atomic(tx => listClosedPeriodsV3(tx, bookId)),
    loadClosedPeriod: scope => {
      const captured = { ...scope };
      return atomic(async tx => { validateScope(captured); const period = await readPeriodV3(tx, captured);
        if (period.status !== 'closed') invalidData(); return period;
      });
    },
    newPublicId: () => atomic(async tx => publicId((await tx.all('SELECT lower(hex(randomblob(16))) AS id'))[0]?.id)),
    saveBudget: saveBudgetOperationV3(atomic),
    startPeriod: startPeriodOperationV3(atomic),
    ...expenseOperationsV3(atomic),
  };
}
