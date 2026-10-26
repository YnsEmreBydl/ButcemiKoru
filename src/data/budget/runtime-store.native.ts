import Constants from 'expo-constants';
import * as SQLite from 'expo-sqlite';
import type { RuntimeStore } from './application-contracts';
import type { PreparationConnection } from './upgrade-preparation';
import type { SqlRow } from './contracts';
import { exclusiveAdapter } from './exclusive-adapter';
import { BudgetStorageError } from './errors';

export type NativeStoreScope = { kind: 'user-v2-only' } | { kind: 'integration'; runId: string };
export async function openNativeRuntimeStore(request: NativeStoreScope): Promise<RuntimeStore> {
  const scope = { ...request };
  const expectedSlug = scope.kind === 'user-v2-only' ? 'gunluk-butcem' : 'gb-v3-integration';
  const isolatedTestBuild = Constants.expoConfig?.extra?.integrationTesting === true;
  if (Constants.expoConfig?.slug !== expectedSlug || (scope.kind === 'integration' && ((!__DEV__ && !isolatedTestBuild) || !/^[0-9a-f]{32}$/.test(scope.runId)))) {
    throw new BudgetStorageError('UNSUPPORTED', 'Veritabanı kapsamı bu uygulama kimliğiyle eşleşmiyor. Dosya açılmadı.');
  }
  const directory = scope.kind === 'user-v2-only' ? SQLite.defaultDatabaseDirectory : `${SQLite.defaultDatabaseDirectory}/gb-v3-integration`;
  const prefix = scope.kind === 'integration' ? `gb-app-${scope.runId}-` : 'gunluk-butcem-';
  const connections = new Set<PreparationConnection>(), native = new Map<PreparationConnection, SQLite.SQLiteDatabase>();
  function filename(key: string): string {
    if (key === 'source') return scope.kind === 'user-v2-only' ? 'gunluk-butcem.db' : `${prefix}source.db`;
    if (key === 'catalog') return `${prefix}control.db`;
    if (scope.kind !== 'integration' || !/^up-[0-9a-f]{16}-(backup|restore|candidate)$/.test(key)) {
      throw new BudgetStorageError('UNSUPPORTED', 'Gerçek kullanıcı verisinde geçiş dosyası oluşturmak bu aşamada kapalı.');
    }
    return `${prefix}${key}.db`;
  }
  async function connect(key: string, fresh: boolean): Promise<PreparationConnection> {
    const db = await SQLite.openDatabaseAsync(filename(key), { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: true }, directory);
    let closed = false;
    try {
      if (fresh && ((await db.getAllAsync("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).length ||
        (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version !== 0)) {
        throw new BudgetStorageError('CONFLICT', 'Yeni geçiş dosyası zaten var; üzerine yazılmadı.');
      }
      if (!fresh && !['source','catalog'].includes(key) && (await db.getAllAsync("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")).length === 0) {
        throw new BudgetStorageError('MIGRATION', 'Geçiş kopyası eksik veya boş. Etkinleştirme durduruldu.');
      }
      await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100;');
      const connection: PreparationConnection = { database: exclusiveAdapter(db),
        query: { exec: sql => db.execAsync(sql), run: (sql, p) => db.runAsync(sql, ...p), all: (sql, p = []) => db.getAllAsync<SqlRow>(sql, ...p) },
        close: async () => { if (!closed) { await db.closeAsync(); closed = true; connections.delete(connection); native.delete(connection); } } };
      connections.add(connection); native.set(connection, db); return connection;
    } catch (error) { await db.closeAsync(); throw error; }
  }
  try {
    const source = await connect('source', false), catalog = await connect('catalog', false);
    return { source, catalog: catalog.database, open: key => connect(key, true), reopen: key => connect(key, false),
      backup: async (from, to) => {
        const a = native.get(from), b = native.get(to);
        if (scope.kind !== 'integration' || !a || !b || a.databasePath === b.databasePath) throw new BudgetStorageError('UNSUPPORTED', 'Yedek dosyası kapsamı geçersiz.');
        await SQLite.backupDatabaseAsync({ sourceDatabase: a, sourceDatabaseName: 'main', destDatabase: b, destDatabaseName: 'main' });
      },
      close: async () => { for (const db of connections) await db.close(); },
    };
  } catch (error) { for (const db of connections) await db.close(); throw error; }
}
