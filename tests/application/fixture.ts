import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { AtomicDatabase, SqlSession } from '../../src/data/budget/contracts';
import type { RuntimeStore } from '../../src/data/budget/application-contracts';
import { createApplicationRuntime } from '../../src/data/budget/application-runtime';
import { clock, seedLegacy } from '../../src/devtools/native-v3/fixtures';
import type { PreparationConnection } from '../../src/data/budget/upgrade-preparation';
import { RealSQLite } from '../storage/sqlite-helper';

/** Uses BEGIN deferred for the catalog, matching Expo's exclusive callback API. */
function deferredDatabase(db: RealSQLite): AtomicDatabase {
  return { transaction: async task => {
    db.db.exec('BEGIN');
    const tx: SqlSession = { exec: async sql => { db.db.exec(sql); },
      all: async (sql, p = []) => db.db.prepare(sql).all(...p), run: async (sql, p) => ({ changes: Number(db.db.prepare(sql).run(...p).changes) }) };
    try { const value = await task(tx); db.db.exec('COMMIT'); return value; }
    catch (error) { if (db.db.isTransaction) db.db.exec('ROLLBACK'); throw error; }
  } };
}
export async function applicationFixture(t: TestContext, empty = false) {
  const directory = mkdtempSync(join(tmpdir(), 'gb-application-7d3-')), all: RuntimeStore[] = [];
  const { backup } = await import('node:sqlite');
  let now = clock;
  const factory = async (): Promise<RuntimeStore> => {
    const native = new Map<PreparationConnection, { db: RealSQLite; file: string }>();
    const connect = async (key: string, fresh: boolean): Promise<PreparationConnection> => {
      if (!/^(source|catalog|up-[0-9a-f]{16}-(backup|restore|candidate))$/.test(key)) throw Error('UNSAFE_TEST_KEY');
      const file = join(directory, `${key}.db`), db = new RealSQLite(file);
      if (fresh && db.db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all().length) { db.close(); throw Error('FILE_EXISTS'); }
      const connection: PreparationConnection = { database: key === 'catalog' ? deferredDatabase(db) : db,
        query: { exec: async sql => { db.db.exec(sql); }, all: async (sql, p = []) => db.db.prepare(sql).all(...p), run: async (sql, p) => ({ changes: Number(db.db.prepare(sql).run(...p).changes) }) },
        close: async () => { db.close(); } };
      native.set(connection, { db, file }); return connection;
    };
    const source = await connect('source', false), catalog = await connect('catalog', false);
    const store: RuntimeStore = { source, catalog: catalog.database, open: key => connect(key, true), reopen: key => connect(key, false),
      backup: async (a, b) => { const from = native.get(a), to = native.get(b); if (!from || !to || from.file === to.file) throw Error('BAD_BACKUP_SCOPE'); await backup(from.db.db, to.file); },
      close: async () => { for (const row of native.values()) row.db.close(); } };
    all.push(store); return store;
  };
  t.after(async () => { for (const store of all) await store.close(); rmSync(directory, { recursive: true, force: true }); });
  const seed = await factory();
  if (!empty) await seedLegacy(seed.source, { v1: readFileSync('tests/expenses/v1-schema.sql', 'utf8'), v2: readFileSync('tests/migrations-v3/fixtures/v2-schema.sql', 'utf8') }, 2);
  await seed.close();
  const create = (options: Partial<Parameters<typeof createApplicationRuntime>[0]> = {}) => createApplicationRuntime({ store: factory, allowV3: true, now: () => now, ...options });
  return { directory, factory, create, setNow: (value: string) => { now = value; }, now: () => now };
}
