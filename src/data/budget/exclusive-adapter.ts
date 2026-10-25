import type { AtomicDatabase, SqlRow, SqlSession, SqlValue } from './contracts';

export interface NativeSession {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...parameters: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync(sql: string, ...parameters: SqlValue[]): Promise<SqlRow[]>;
}
export interface ExclusiveConnection {
  withExclusiveTransactionAsync(task: (transaction: NativeSession) => Promise<void>): Promise<void>;
}
export function exclusiveAdapter(connection: ExclusiveConnection): AtomicDatabase {
  return {
    async transaction<T>(task: (tx: SqlSession) => Promise<T>): Promise<T> {
      const box: { result?: { value: T } } = {};
      await connection.withExclusiveTransactionAsync(async (tx) => {
        box.result = { value: await task({
          exec: (sql) => tx.execAsync(sql),
          run: (sql, parameters) => tx.runAsync(sql, ...parameters),
          all: (sql, parameters = []) => tx.getAllAsync(sql, ...parameters),
        }) };
      });
      // Reached only after native COMMIT and connection completion, not callback completion.
      if (!box.result) throw new Error('Native transaction did not execute its callback.');
      return box.result.value;
    },
  };
}
