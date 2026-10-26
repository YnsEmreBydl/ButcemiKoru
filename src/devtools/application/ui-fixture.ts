import { calendarDaysBetween } from '../../domain/budget';
import type { PreparationConnection } from '../../data/budget/upgrade-preparation';
import { seedLegacy } from '../native-v3/fixtures';
import type { LabConfig } from '../native-v3/types';

/** Synthetic dates only. The real engine and stored user dates are never changed. */
export function fixtureDay(today: string, offset: number): string {
  calendarDaysBetween(today,today);
  const date = new Date(`${today}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate()+offset);
  const result = date.toISOString().slice(0,10); calendarDaysBetween(result,result); return result;
}
export async function seedApplicationUIFixture(source: PreparationConnection, fixtures: LabConfig['fixtures'], today: string): Promise<void> {
  const past = fixtureDay(today,-1), opening = fixtureDay(today,-7);
  await seedLegacy({ ...source, database: { transaction: task => source.database.transaction(tx => task({ ...tx,
    run: (sql, args) => {
      const next = [...args];
      if (sql.startsWith('INSERT INTO budget_periods VALUES')) { next[5] = `${opening}T09:00:00+03:00`; next[6] = today; }
      if (sql.startsWith('INSERT INTO budget_payments VALUES')) next[4] = past;
      if (sql.startsWith('INSERT INTO budget_expenses VALUES')) {
        const occurred = next[0] === 'at-snapshot' ? `${opening}T06:00:00.000Z` :
          `${fixtureDay(today,next[0] === 'pre-snapshot' ? -8 : next[0] === 'cancelled-old' ? -2 : -1)}T08:00:00.000Z`;
        next[5] = occurred; next[6] = occurred;
        if (next[7] === 'cancelled') next[8] = `${past}T08:30:00.000Z`;
      }
      return tx.run(sql,next);
    },
  })) } }, fixtures,2);
}
