import type { TestContext } from 'node:test';
import type { AddExpenseCommand, CancelExpenseCommand, SaveBudgetCommand } from '../../src/data/budget/contracts';
import { migrateDatabase } from '../../src/data/budget/migrations';
import { createBudgetRepository } from '../../src/data/budget/repository';
import { command, databaseFixture } from '../storage/sqlite-helper';

export const now = '2026-10-25T09:00:00Z';
export function add(overrides: Partial<AddExpenseCommand> = {}): AddExpenseCommand {
  return {
    operationId: 'expense-op', expectedRevision: 1, periodId: 1, asOf: now,
    expense: { id: 'expense-one', amountMinor: 10000, category: 'market', description: '', occurredAt: '2026-10-25T08:00:00Z', createdAt: now },
    ...overrides,
  };
}
export function cancel(overrides: Partial<CancelExpenseCommand> = {}): CancelExpenseCommand {
  return { operationId: 'cancel-op', expectedRevision: 2, periodId: 1, expenseId: 'expense-one', cancelledAt: now, asOf: now, ...overrides };
}
export async function fixture(t: TestContext, initial: SaveBudgetCommand = command()) {
  const files = databaseFixture(t), db = files.open();
  await migrateDatabase(db);
  const repo = createBudgetRepository(db);
  const saved = await repo.save(initial);
  return { files, db, repo, saved };
}
