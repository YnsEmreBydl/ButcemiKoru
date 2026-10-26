import type { AtomicDatabase, SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { integer, stringValue } from './guards';

export type RuntimeEntry = Readonly<{ epoch: number; schema: 2 | 3; activeKey: string; phase: 'ready' | 'pending'; operationId: string | null; prefix: string | null }>;
const ddl = `CREATE TABLE runtime_state(id INTEGER PRIMARY KEY CHECK(id=1),
 epoch INTEGER NOT NULL CHECK(epoch BETWEEN 1 AND 9007199254740991),
 schema_version INTEGER NOT NULL CHECK(schema_version IN (2,3)),active_key TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('ready','pending')),operation_id TEXT,prefix TEXT,
 CHECK((phase='pending' AND operation_id IS NOT NULL AND prefix IS NOT NULL AND schema_version=2) OR
       (phase='ready' AND operation_id IS NULL AND prefix IS NULL))) STRICT;
CREATE TABLE runtime_transitions(operation_id TEXT PRIMARY KEY,from_epoch INTEGER NOT NULL,
 prefix TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','activated','recovered')),
 target_key TEXT NOT NULL) STRICT;`;

export function runtimeBlocked(message = 'Bütçe geçişi veya kurtarma sürüyor. Finansal işlem uygulanmadı.'): never {
  throw new BudgetStorageError('MIGRATION', message);
}

/** Expo exclusive transactions BEGIN deferred. A SELECT alone is NOT a writer fence in WAL.
 * Acquire the catalog write lock before reading any authorization/pointer state. */
export function catalogWriterMutex(database: AtomicDatabase): AtomicDatabase {
  return { transaction: task => database.transaction(async tx => {
    await tx.run('UPDATE runtime_state SET epoch=epoch WHERE id=1', []);
    return task(tx);
  }) };
}
export async function initializeCatalog(db: AtomicDatabase): Promise<void> {
  await db.transaction(async tx => {
    const version = (await tx.all('PRAGMA user_version'))[0]?.user_version;
    if (version === 0) {
      if ((await tx.all("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).length) runtimeBlocked('Kontrol dosyası tanınmıyor. Sıfırlama yapılmadı.');
      await tx.exec(ddl);
      await tx.run('INSERT INTO runtime_state VALUES(1,1,2,?,?,NULL,NULL)', ['source', 'ready']);
      await tx.exec('PRAGMA user_version=1');
    } else if (version !== 1) runtimeBlocked('Kontrol dosyasının sürümü desteklenmiyor.');
    await readRuntimeEntry(tx);
  });
}
export async function readRuntimeEntry(tx: SqlSession): Promise<RuntimeEntry> {
  const rows = await tx.all('SELECT * FROM runtime_state');
  if (rows.length !== 1) runtimeBlocked();
  const row = rows[0], epoch = integer(row.epoch);
  if (epoch < 1 || (row.schema_version !== 2 && row.schema_version !== 3) || !['ready','pending'].includes(String(row.phase))) runtimeBlocked();
  const activeKey = stringValue(row.active_key);
  if (!/^(source|up-[0-9a-f]{16}-candidate)$/.test(activeKey)) runtimeBlocked();
  const operationId = row.operation_id === null ? null : stringValue(row.operation_id), prefix = row.prefix === null ? null : stringValue(row.prefix);
  if ((row.phase === 'pending') !== (operationId !== null && prefix !== null) || (prefix && !/^up-[0-9a-f]{16}$/.test(prefix))) runtimeBlocked();
  if (row.schema_version === 3) {
    if (row.phase !== 'ready' || activeKey === 'source' || epoch < 2) runtimeBlocked();
    const receipt = await tx.all("SELECT operation_id FROM runtime_transitions WHERE status='activated' AND target_key=? AND from_epoch=?", [activeKey, epoch - 1]);
    if (receipt.length !== 1) runtimeBlocked('Aktif v3 dosyasının geçiş makbuzu doğrulanamadı.');
  } else {
    if (activeKey !== 'source' || epoch !== 1 || (await tx.all("SELECT operation_id FROM runtime_transitions WHERE status='activated' LIMIT 1")).length) {
      runtimeBlocked('Geçiş günlüğü ile v2 işaretçisi tutarsız. Eski yedeğe otomatik dönüş yapılmadı.');
    }
    if (row.phase === 'pending') {
      if (!operationId || !/^[0-9a-f]{32}$/.test(operationId)) runtimeBlocked();
      const receipt = await tx.all("SELECT prefix,target_key,from_epoch FROM runtime_transitions WHERE operation_id=? AND status='pending'", [operationId]);
      if (receipt.length !== 1 || receipt[0].prefix !== prefix || receipt[0].target_key !== `${prefix}-candidate` || receipt[0].from_epoch !== epoch) runtimeBlocked('Yarım geçişin işlem kaydı doğrulanamadı.');
    }
  }
  return { epoch, schema: row.schema_version, activeKey, phase: row.phase === 'pending' ? 'pending' : 'ready', operationId, prefix };
}
