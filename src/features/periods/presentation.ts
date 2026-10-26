import { calendarDateAt } from '../../domain/budget';
import type { ClosedPeriodV3, SavedPeriodV3 } from '../../data/budget/v3-contracts';
import { formatCalendarDate, formatMinorTRY } from '../budget-setup/format';
import { categoryLabels, formatExpenseTime } from '../expenses/adapter';

export function periodRange(period: SavedPeriodV3): string {
  const first = calendarDateAt(period.openedAt, period.input.timeZone);
  const last = period.status === 'closed' ? calendarDateAt(period.closedAt, period.input.timeZone) : period.input.nextPayday;
  return `${formatCalendarDate(first)} — ${formatCalendarDate(last)}`;
}
/** Archive presentation has no clock, recalculation or write dependency. */
export function presentArchive(period: ClosedPeriodV3) {
  const newestFirst = (left: string, right: string) => left === right ? 0 : left < right ? 1 : -1;
  return {
    range: periodRange(period), closedAt: formatExpenseTime(period.closedAt, period.input.timeZone),
    spent: formatMinorTRY(period.result.spentSinceSnapshotMinor), balance: formatMinorTRY(period.result.remainingBalanceMinor),
    spendable: formatMinorTRY(period.result.spendableMinor), deficit: formatMinorTRY(period.result.budgetDeficitMinor),
    expenses: [...period.expenses].sort((left, right) => newestFirst(left.occurredAt, right.occurredAt) ||
      newestFirst(left.createdAt, right.createdAt) || newestFirst(left.id, right.id)).map(expense => ({ id: expense.id, label: categoryLabels[expense.category],
      amount: formatMinorTRY(-expense.amountMinor), description: expense.description, cancelled: expense.status === 'cancelled',
      occurredAt: formatExpenseTime(expense.occurredAt, period.input.timeZone),
      createdAt: formatExpenseTime(expense.createdAt, period.input.timeZone),
      cancelledAt: expense.cancelledAt ? formatExpenseTime(expense.cancelledAt, period.input.timeZone) : null,
      includedInBalance: Date.parse(expense.occurredAt) <= Date.parse(period.input.balanceSnapshot.capturedAt),
    })),
  };
}
