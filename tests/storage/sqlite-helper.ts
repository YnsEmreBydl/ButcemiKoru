import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import type { AtomicDatabase, SaveBudgetCommand, SqlSession } from '../../src/data/budget/contracts';
import { budget } from '../budget/fixtures';

/** Real SQLite 3 via Node's built-in driver; this is not an SQL mock. */
export class RealSQLite implements AtomicDatabase {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    try { this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;'); }
    catch (error) { this.db.close(); throw error; }
  }
  async transaction<T>(task: (session: SqlSession) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = await task({
        exec: async (sql) => { this.db.exec(sql); },
        run: async (sql, parameters) => ({ changes: Number(this.db.prepare(sql).run(...parameters).changes) }),
        all: async (sql, parameters = []) => this.db.prepare(sql).all(...parameters),
      });
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { if (this.db.isOpen) this.db.close(); }
}

export function databaseFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'gunluk-butcem-sqlite-'));
  const file = join(directory, 'budget.db');
  const connections: RealSQLite[] = [];
  const open = () => { const db = new RealSQLite(file); connections.push(db); return db; };
  t.after(() => { connections.forEach((connection) => connection.close()); rmSync(directory, { recursive: true, force: true }); });
  return { open, file };
}

export function command(overrides: Partial<SaveBudgetCommand> = {}): SaveBudgetCommand {
  return { operationId: 'create-1', expectedRevision: null, input: budget(), paymentNames: [{ id: 'rent', name: 'Kira' }], ...overrides };
}
