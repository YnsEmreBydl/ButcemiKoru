import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { BudgetRepository, SqlRow } from './contracts';
import { exclusiveAdapter, type NativeSession } from './exclusive-adapter';
import { migrateDatabase } from './migrations';
import { createBudgetRepository } from './repository';

let opening: Promise<BudgetRepository> | null = null;

function session(db: SQLiteDatabase): NativeSession {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, ...parameters) => db.runAsync(sql, ...parameters),
    getAllAsync: (sql, ...parameters) => db.getAllAsync<SqlRow>(sql, ...parameters),
  };
}

async function open(): Promise<BudgetRepository> {
  const db = await openDatabaseAsync('gunluk-butcem.db');
  try {
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const adapter = exclusiveAdapter({
      withExclusiveTransactionAsync: (task) => db.withExclusiveTransactionAsync((tx) => task(session(tx))),
    });
    await migrateDatabase(adapter);
    return createBudgetRepository(adapter);
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

export function getBudgetRepository(): Promise<BudgetRepository> {
  if (!opening) opening = open().catch((error: unknown) => { opening = null; throw error; });
  return opening;
}
