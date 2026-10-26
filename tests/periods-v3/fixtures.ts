import type { TestContext } from 'node:test';
import type { AtomicDatabase, SqlSession } from '../../src/data/budget/contracts';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { createBudgetRepositoryV3 } from '../../src/data/budget/repository-v3';
import type { ActivePeriodV3, AddExpenseCommandV3, PeriodScopeV3, SaveBudgetCommandV3, StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { budget } from '../budget/fixtures';
import { legacyFixture } from '../migrations-v3/fixtures';
import { databaseFixture } from '../storage/sqlite-helper';

export const beforePayday = '2026-10-26T09:00:00.000Z';
export const payday = '2026-11-04T09:00:00.000Z';
export const nextPayday = '2026-12-04T09:00:00.000Z';
export function pid(n: number): string { return n.toString(16).padStart(32, '0'); }
export function scope(period: { id: number; publicId: string; bookId: number }): PeriodScopeV3 {
  return { bookId: period.bookId, periodId: period.id, periodPublicId: period.publicId };
}
export async function fixture(t: TestContext, foreignKeys = 1) {
  const files = databaseFixture(t); const db = files.open(); legacyFixture(db, 2);
  db.db.exec(`PRAGMA foreign_keys=${foreignKeys}`); await migrateDatabaseV3(db);
  const repo = createBudgetRepositoryV3(db); const active = await repo.loadActivePeriod(1, beforePayday);
  if (!active) throw Error('missing fixture');
  return { files, db, repo, active };
}
export function start(source: ActivePeriodV3, overrides: Partial<StartPeriodCommandV3> = {}): StartPeriodCommandV3 {
  const rent = source.payments.find(row => row.id === 'rent');
  return { operationId: 'a-to-b', bookId: source.bookId, sourcePeriodId: source.id, sourcePeriodPublicId: source.publicId,
    expectedSourceRevision: source.revision, expectedActivationRevision: 1, newPeriodPublicId: pid(2),
    availableBalanceConfirmed: true, availableBalanceMinor: 300000, balanceCapturedAt: payday,
    nextPayday: '2026-12-04', savingsTargetMinor: 50000, asOf: payday,
    carryPayments: rent ? [{ sourcePaymentId: rent.id, sourcePaymentPublicId: rent.publicId, newId: 'b-rent', newPublicId: pid(200), dueOn: '2026-11-28' }] : [],
    ...overrides };
}
export function add(period: ActivePeriodV3, overrides: Partial<AddExpenseCommandV3> = {}): AddExpenseCommandV3 {
  return { ...scope(period), operationId: 'b-expense', expectedRevision: period.revision,
    expectedActivationRevision: 2, expensePublicId: pid(300), asOf: '2026-11-05T09:00:00.000Z',
    expense: { id: 'b-expense-id', amountMinor: 10000, category: 'market', description: 'Sentetik test',
      occurredAt: '2026-11-05T08:00:00.000Z', createdAt: '2026-11-05T09:00:00.000Z' }, ...overrides };
}
export function initial(overrides: Partial<SaveBudgetCommandV3> = {}): SaveBudgetCommandV3 {
  return { operationId: 'initial-v3', bookId: 1, expectedActivationRevision: 0,
    target: { kind: 'initial', publicId: pid(1000) }, input: budget(), paymentNames: [{ id: 'rent', name: 'Kira' }], ...overrides };
}
export function edit(period: ActivePeriodV3, overrides: Partial<SaveBudgetCommandV3> = {}): SaveBudgetCommandV3 {
  return { operationId: 'edit-v3', bookId: period.bookId, expectedActivationRevision: 2,
    target: { kind: 'existing', periodId: period.id, publicId: period.publicId, expectedRevision: period.revision },
    input: { ...period.input, transactions: [] }, paymentNames: period.payments.map(row => ({ id: row.id, name: row.name })), ...overrides };
}

export function inject(database: AtomicDatabase, afterSQL: (sql: string, tx: SqlSession) => Promise<void>): AtomicDatabase {
  return { transaction: task => database.transaction(tx => task({ ...tx,
    run: async (sql, params) => { const result = await tx.run(sql, params); await afterSQL(sql, tx); return result; },
  })) };
}
