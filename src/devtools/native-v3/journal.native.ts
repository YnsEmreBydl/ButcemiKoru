import * as SQLite from 'expo-sqlite';
import { exclusiveAdapter } from '../../data/budget/exclusive-adapter';
import { assertNativeLab } from './driver.native';
import type { RunJournal } from './coordinator';
import { ensure, labFileName } from './types';

/** Lab-only control file. Contains run IDs/status only; no budget rows. No deletes. */
export function createNativeRunJournal(projectId: string): RunJournal {
  async function withJournal<T>(task: (database: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    assertNativeLab();
    const db = await SQLite.openDatabaseAsync(labFileName(projectId, 'control'), { useNewConnection: true }, `${SQLite.defaultDatabaseDirectory}/gb-v3-native-lab`);
    try {
      const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      ensure(tables.every(row => row.name === 'gb_lab_runs'), 'UNEXPECTED_CONTROL_SCHEMA');
      await db.execAsync(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS gb_lab_runs(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE CHECK(length(run_id)=32 AND run_id NOT GLOB '*[^0-9a-f]*'),
        status TEXT NOT NULL CHECK(status IN ('running','passed','failed'))) STRICT;`);
      return await task(db);
    } finally { await db.closeAsync(); }
  }
  return {
    begin: () => withJournal(db => exclusiveAdapter(db).transaction(async tx => {
      const runId = (await tx.all('SELECT lower(hex(randomblob(16))) AS id'))[0]?.id;
      ensure(typeof runId === 'string', 'MISSING_RUN_ID'); labFileName(runId, 'guard');
      await tx.run('INSERT INTO gb_lab_runs(run_id,status) VALUES(?,?)', [runId, 'running']); return runId;
    })),
    finish: (id, passed) => withJournal(async db => {
      labFileName(id, 'guard');
      ensure((await db.runAsync("UPDATE gb_lab_runs SET status=? WHERE run_id=? AND status='running'", passed ? 'passed' : 'failed', id)).changes === 1, 'RUN_JOURNAL_CONFLICT');
    }),
    lastCompleted: () => withJournal(async db => {
      const row = await db.getFirstAsync<{ run_id: string }>("SELECT run_id FROM gb_lab_runs WHERE status='passed' ORDER BY sequence DESC LIMIT 1");
      if (!row) return null; labFileName(row.run_id, 'guard'); return row.run_id;
    }),
  };
}
