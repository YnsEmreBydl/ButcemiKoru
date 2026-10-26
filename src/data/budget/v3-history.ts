import type { SqlSession } from './contracts';
import { invalidData } from './guards';
import type { ClosedPeriodV3 } from './v3-contracts';
import { readBookV3, readPeriodV3 } from './v3-records';
import { positiveInteger, publicId } from './v3-validation';

/** Read-only, book-scoped history. No "today" clock is supplied to archived periods. */
export async function listClosedPeriodsV3(tx: SqlSession, bookId: number): Promise<readonly ClosedPeriodV3[]> {
  await readBookV3(tx, bookId);
  const rows = await tx.all("SELECT id,public_id FROM budget_periods WHERE book_id=? AND status='closed' ORDER BY closed_at DESC,id DESC", [bookId]);
  const periods: ClosedPeriodV3[] = [];
  for (const row of rows) {
    const period = await readPeriodV3(tx, { bookId, periodId: positiveInteger(row.id), periodPublicId: publicId(row.public_id) });
    if (period.status !== 'closed') invalidData(); periods.push(period);
  }
  return periods;
}
