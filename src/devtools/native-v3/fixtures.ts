import type { AtomicDatabase, SqlSession } from '../../data/budget/contracts';
import { legacyColumns } from '../../data/budget/integrity-v3';
import { migrateDatabaseV3 } from '../../data/budget/migrations-v3';
import { createBudgetRepositoryV3 } from '../../data/budget/repository-v3';
import type { ActivePeriodV3, StartPeriodCommandV3 } from '../../data/budget/v3-contracts';
import { ensure, type LabConfig, type LabConnection } from './types';

export const clock = '2026-10-25T09:00:00.000Z', payday = '2026-11-04T09:00:00.000Z', nextPayday = '2026-12-04T09:00:00.000Z';
export const publicId = (number: number) => number.toString(16).padStart(32, '0');
export async function seedLegacy(connection: LabConnection, fixtures: LabConfig['fixtures'], version: 1 | 2): Promise<void> {
  await connection.database.transaction(async tx => {
    await tx.exec(version === 1 ? fixtures.v1 : fixtures.v2);
    await tx.exec(version === 1 ? 'PRAGMA user_version=1' : 'PRAGMA user_version=2');
    await tx.run('INSERT INTO budget_periods VALUES(?,?,?,?,?,?,?,?)', [1,5,'TRY','Europe/Istanbul',1000000,'2026-10-20T09:00:00+03:00','2026-11-04',100000]);
    await tx.run('INSERT INTO budget_payments VALUES(?,?,?,?,?)', [1,'rent','Synthetic bill',200000,'2026-10-28']);
    await tx.run('INSERT INTO budget_payments VALUES(?,?,?,?,?)', [1,'electric','Synthetic electric',10000,'2026-10-29']);
    await tx.run('INSERT INTO budget_save_operations VALUES(?,?,?,?)', ['old-receipt',1,' opaque legacy receipt\n',1]);
    if (version === 2) for (const [id,at,status,cancelled] of [
      ['active-old','2026-10-25T08:00:00.000Z','active',null],
      ['cancelled-old','2026-10-24T08:00:00.000Z','cancelled','2026-10-25T08:30:00.000Z'],
      ['pre-snapshot','2026-10-19T08:00:00.000Z','active',null],
      ['at-snapshot','2026-10-20T06:00:00.000Z','active',null],
    ] as const) await tx.run('INSERT INTO budget_expenses VALUES(?,?,?,?,?,?,?,?,?)', [id,1,101,'market','Synthetic test',at,at,status,cancelled]);
  });
}
export async function oldData(tx: SqlSession, version: 1 | 2) {
  const data: Record<string, unknown> = {};
  for (const [table, columns] of Object.entries(legacyColumns)) {
    data[table] = table === 'budget_expenses' && version === 1 ? [] : await tx.all(`SELECT ${columns} FROM ${table} ORDER BY 1,2`);
  }
  return JSON.stringify(data);
}
export async function snapshot(tx: SqlSession): Promise<string> {
  const schema = await tx.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
  const data: Record<string, unknown> = {};
  for (const row of schema) if (row.type === 'table') {
    ensure(typeof row.name === 'string' && /^[a-z_0-9]+$/.test(row.name), 'UNSAFE_TEST_TABLE');
    data[row.name] = await tx.all(`SELECT * FROM ${row.name} ORDER BY rowid`);
  }
  return JSON.stringify({ version: await tx.all('PRAGMA user_version'), schema, data });
}
export async function prepare(connection: LabConnection, config: LabConfig) {
  await seedLegacy(connection, config.fixtures, 2); await migrateDatabaseV3(connection.database);
  const repository = createBudgetRepositoryV3(connection.database), source = await repository.loadActivePeriod(1, clock);
  ensure(source, 'MISSING_SOURCE'); return { repository, source };
}
export function start(source: ActivePeriodV3, changes: Partial<StartPeriodCommandV3> = {}): StartPeriodCommandV3 {
  const bill = source.payments.find(row => row.id === 'rent');
  return { operationId: 'a-b', bookId: source.bookId, sourcePeriodId: source.id, sourcePeriodPublicId: source.publicId,
    expectedSourceRevision: source.revision, expectedActivationRevision: 1, newPeriodPublicId: publicId(100),
    availableBalanceConfirmed: true, availableBalanceMinor: 300000, balanceCapturedAt: payday, nextPayday: '2026-12-04',
    savingsTargetMinor: 50000, asOf: payday, carryPayments: bill ? [{ sourcePaymentId: bill.id, sourcePaymentPublicId: bill.publicId,
      newId: 'new-rent', newPublicId: publicId(200), dueOn: '2026-11-28' }] : [], ...changes };
}
export function faultAfter(database: AtomicDatabase, matches: (sql: string) => boolean, action: (tx: SqlSession) => Promise<void>): AtomicDatabase {
  return { transaction: task => database.transaction(tx => task({ ...tx,
    exec: async sql => { await tx.exec(sql); if (matches(sql)) await action(tx); },
    run: async (sql, params) => { const result = await tx.run(sql,params); if (matches(sql)) await action(tx); return result; },
  })) };
}
